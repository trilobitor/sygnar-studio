#!/usr/bin/env bash
# AiOS Fazowy v1.0-S — BRAMKI (deterministyczny kręgosłup protokołu)
#
#   gate.sh A    <TASK>                    build + lint (+tsc) + detektory (preflight)
#   gate.sh B    <TASK> --routes "/,/x" [--api "/api/kontakt"]   runtime smoke + a11y
#   gate.sh C    <TASK> --routes "/"      screenshoty mobile+desktop dla ślepego Recenzenta
#   gate.sh task <TASK> [opcje B]         A, potem B (bramka per zadanie)
#   gate.sh metrics                       przelicza telemetry/protocol-metrics.json
#
# Konfiguracja przez env (dla innych stacków / testów):
#   BUILD_CMD, LINT_CMD, TSC_CMD, START_CMD, PORT, BASE_URL, GATE_B_WAIT
#
# Reguły twarde v1.0-S:
#   • FAIL tworzy stub RCA i podbija licznik iteracji (per zadanie×bramka).
#   • Druga próba NIE ruszy, dopóki RCA z poprzedniej nie ma wypełnionego `- detect:`.
#   • Trzeci FAIL = ESKALACJA do człowieka. Licznik zeruje się przy PASS.
#   • Serwer ubijamy wyłącznie po PID. Nigdy `pkill -f next`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${AIOS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"
. "$SCRIPT_DIR/lib/aios-root.sh" 2>/dev/null || { echo "gate.sh: brak scripts/lib/aios-root.sh — powłoka niekompletna" >&2; exit 78; }
STATE="$(aios_state_root "$ROOT")"

BUILD_CMD="${BUILD_CMD:-npm run build}"
LINT_CMD="${LINT_CMD:-npm run lint}"
TSC_CMD="${TSC_CMD:-npx tsc --noEmit}"
START_CMD="${START_CMD:-npm run start}"
PORT="${PORT:-3999}"
BASE_URL="${BASE_URL:-http://localhost:$PORT}"
GATE_B_WAIT="${GATE_B_WAIT:-6}"
LIMIT_ITER=3

MODE="${1:-}"; [ -n "$MODE" ] && shift || { echo "użycie: gate.sh <A|B|C|task|metrics> …" >&2; exit 64; }
TASK="${1:-}"
case "$MODE" in metrics) TASK="${TASK:--}";; *) [ -n "$TASK" ] || { echo "gate.sh: podaj TASK_ID" >&2; exit 64; }; shift;; esac

ROUTES="/"; API=""; SKIP_TSC=0
while [ $# -gt 0 ]; do
  case "$1" in
    --routes)   ROUTES="$2"; shift 2 ;;
    --api)      API="$2";    shift 2 ;;
    --skip-tsc) SKIP_TSC=1;  shift ;;
    *) echo "gate.sh: nieznana opcja: $1" >&2; exit 64 ;;
  esac
done

ART="$STATE/.aios/artifacts"; mkdir -p "$ART" "$STATE/.aios" "$STATE/telemetry" "$ROOT/docs/rca"
NOW() { date -Iseconds; }
tlm() { printf '%s\n' "$1" >> "$STATE/telemetry/events.jsonl"; }
json_escape() { printf '%s' "$1" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

iter_file() { printf '%s' "$STATE/.aios/iter_${TASK}_$1"; }
iter_get()  { cat "$(iter_file "$1")" 2>/dev/null || echo 0; }
iter_set()  { printf '%s' "$2" > "$(iter_file "$1")"; }

znajdz_rca() {                       # $1 = bramka; stdout: ścieżka albo puste; kod zawsze 0
  local g="$1" w
  set --                                                     # czyścimy listę pozycyjną
  set -- "$@" "$ROOT"/docs/rca/RCA_"${TASK}"_"${g}"_*.md     # własne drzewo ZAWSZE w zbiorze
  while IFS= read -r w; do
    [ -n "$w" ] || continue
    set -- "$@" "$w"/docs/rca/RCA_"${TASK}"_"${g}"_*.md
  done < <(git -C "$ROOT" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
  ls -t -- "$@" 2>/dev/null | head -1
}

require_rca_if_retry() { # $1 = bramka
  local g="$1" it last
  it="$(iter_get "$g")"
  [ "$it" -ge 1 ] || return 0
  last="$(znajdz_rca "$g" || true)"
  if [ -z "$last" ]; then
    echo "BRAMKA $g: iteracja $((it+1)) dla $TASK, a w żadnym drzewie roboczym repozytorium nie ma RCA" >&2
    echo "z poprzedniego FAIL. Licznik iteracji jest WSPÓLNY dla repozytorium (scripts/lib/aios-root.sh)," >&2
    echo "więc poprzedni FAIL mógł paść w drzewie, którego już nie ma." >&2
    echo "Wypełnij RCA albo — świadomie — wyzeruj licznik: rm $STATE/.aios/iter_${TASK}_$g" >&2
    exit 70
  fi
  case "$last" in
    "$ROOT"/*) ;;
    *) echo "  (RCA z poprzedniego FAIL znalezione w innym drzewie roboczym: $last)" ;;
  esac
  if ! grep -E '^- detect: ' "$last" | grep -vq 'TODO'; then
    echo "" >&2
    echo "⛔ BRAMKA $g ZABLOKOWANA: RCA niekompletne." >&2
    echo "   Uzupełnij pole '- detect:' w: ${last#$ROOT/}" >&2
    echo "   Protokół nie wpuszcza poprawki bez diagnozy przyczyny źródłowej." >&2
    exit 75
  fi
}

make_rca_stub() { # $1 = bramka, $2 = iteracja, $3 = powód (multiline)
  local g="$1" it="$2" powod="$3" out tpl
  out="$ROOT/docs/rca/RCA_${TASK}_${g}_${it}.md"
  [ -f "$out" ] && out="$ROOT/docs/rca/RCA_${TASK}_${g}_${it}_$(date +%H%M%S).md"
  tpl="$(cat "$ROOT/docs/RCA_TEMPLATE.md")"
  tpl="${tpl//\{\{TASK\}\}/$TASK}"
  tpl="${tpl//\{\{GATE\}\}/$g}"
  tpl="${tpl//\{\{ITER\}\}/$it}"
  tpl="${tpl//\{\{DATE\}\}/$(NOW)}"
  tpl="${tpl//\{\{POWOD\}\}/$powod}"
  printf '%s\n' "$tpl" > "$out"
  printf '%s' "${out#$ROOT/}"
}

gate_fail() { # $1 = bramka, $2 = powód (multiline)
  local g="$1" powod="$2" it rca
  it=$(( $(iter_get "$g") + 1 )); iter_set "$g" "$it"
  rca="$(make_rca_stub "$g" "$it" "$powod")"
  tlm "$(printf '{"ts":"%s","typ":"gate","bramka":"%s","task":"%s","wynik":"FAIL","iteracja":%d,"powod":"%s","rca":"%s"}' \
        "$(NOW)" "$g" "$TASK" "$it" "$(json_escape "$powod")" "$rca")"
  echo ""
  echo "✗ BRAMKA $g: FAIL (iteracja $it/$LIMIT_ITER) — zadanie $TASK"
  printf '%s\n' "$powod" | sed 's/^/    /'
  echo "  → RCA (stub): $rca — wypełnij, w tym OBOWIĄZKOWE pole 'detect:'"
  echo "  → po naprawie: scripts/add-pitfall.sh $rca  (błąd stanie się detektorem)"
  if [ "$it" -ge "$LIMIT_ITER" ]; then
    tlm "$(printf '{"ts":"%s","typ":"eskalacja","bramka":"%s","task":"%s","iteracja":%d}' "$(NOW)" "$g" "$TASK" "$it")"
    echo ""
    echo "🛑 ESKALACJA: $LIMIT_ITER nieudane iteracje bramki $g dla $TASK."
    echo "   Protokół zatrzymany — decyzja człowieka (jedyny wyjątek aktywujący go w przebiegu)."
  fi
  exit 1
}

gate_pass() { # $1 = bramka, $2 = info
  local g="$1" info="${2:-}"
  iter_set "$g" 0
  rm -f "$STATE/.aios/dirty"
  tlm "$(printf '{"ts":"%s","typ":"gate","bramka":"%s","task":"%s","wynik":"PASS","info":"%s"}' \
        "$(NOW)" "$g" "$TASK" "$(json_escape "$info")")"
  echo "✓ BRAMKA $g: PASS — zadanie $TASK${info:+ · $info}"
}

step() { # $1 = etykieta, $2 = komenda; loguje do artefaktów; zwraca rc komendy
  local label="$1" cmd="$2" logf rc
  logf="$ART/log_${TASK}_${label// /_}.txt"
  printf '  • %s … ' "$label"
  bash -c "$cmd" > "$logf" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then echo "OK"; else echo "BŁĄD (log: ${logf#$STATE/})"; fi
  return $rc
}

start_server() {
  bash -c "PORT=$PORT $START_CMD" > "$ART/log_${TASK}_server.txt" 2>&1 &
  SRV=$!
  sleep "$GATE_B_WAIT"
  if ! kill -0 "$SRV" 2>/dev/null; then
    echo "serwer nie wystartował (START_CMD='$START_CMD', log: ${ART#$STATE/}/log_${TASK}_server.txt)"
    return 1
  fi
  return 0
}
stop_server() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null || true; SRV=""; }

# ── BRAMKA A: statyczna ───────────────────────────────────────────────────────
gate_A() {
  require_rca_if_retry A
  echo "BRAMKA A (statyczna) — $TASK"
  local reasons=""
  step "build" "$BUILD_CMD" || reasons="${reasons}build: FAIL ($BUILD_CMD)"$'\n'
  step "lint"  "$LINT_CMD"  || reasons="${reasons}lint: FAIL ($LINT_CMD)"$'\n'
  if [ "$SKIP_TSC" -eq 0 ] && [ -f "$ROOT/tsconfig.json" ]; then
    step "tsc" "$TSC_CMD" || reasons="${reasons}tsc: FAIL ($TSC_CMD)"$'\n'
  fi
  echo "  • detektory (preflight) …"
  local pf_out pf_rc
  pf_out="$(bash "$SCRIPT_DIR/preflight.sh" --task "$TASK" 2>&1)"; pf_rc=$?
  printf '%s\n' "$pf_out" | sed 's/^/    /'
  [ $pf_rc -eq 0 ] || reasons="${reasons}detektory: $(printf '%s\n' "$pf_out" | grep '\[FAIL\]' | sed 's/^ *//' | paste -sd ';' -)"$'\n'
  [ -z "$reasons" ] && gate_pass A || gate_fail A "$reasons"
}

# ── BRAMKA B: runtime smoke ──────────────────────────────────────────────────
gate_B() {
  require_rca_if_retry B
  echo "BRAMKA B (runtime) — $TASK · routes: $ROUTES${API:+ · api: $API}"
  local reasons="" code html h1c
  if ! start_server; then gate_fail B "serwer nie wystartował"; fi
  IFS=',' read -r -a RARR <<< "$ROUTES"
  for r in "${RARR[@]}"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$r" || echo 000)"
    printf '  • GET %s → %s\n' "$r" "$code"
    [ "$code" = "200" ] || reasons="${reasons}GET $r → $code (oczekiwano 200)"$'\n'
    html="$(curl -s "$BASE_URL$r" || true)"
    h1c="$(printf '%s' "$html" | grep -o '<h1' | wc -l | tr -d ' ')"
    [ "$h1c" = "1" ] || reasons="${reasons}a11y $r: <h1> ×$h1c (wymagane dokładnie 1)"$'\n'
    printf '%s' "$html" | grep -q '<html[^>]* lang=' || reasons="${reasons}a11y $r: brak atrybutu lang na <html>"$'\n'
  done
  if [ -n "$API" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE_URL$API" || echo 000)"
    printf '  • POST %s (invalid) → %s\n' "$API" "$code"
    [ "$code" = "422" ] || reasons="${reasons}POST $API invalid → $code (oczekiwano 422)"$'\n'
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"honeypot":"x"}' "$BASE_URL$API" || echo 000)"
    printf '  • POST %s (honeypot) → %s\n' "$API" "$code"
    [ "$code" = "200" ] || reasons="${reasons}POST $API honeypot → $code (oczekiwano cichego 200)"$'\n'
  fi
  stop_server
  [ -z "$reasons" ] && gate_pass B "routes: $ROUTES" || gate_fail B "$reasons"
}

# ── BRAMKA C: wizualna (materiał dla ślepego Recenzenta) ─────────────────────
gate_C() {
  require_rca_if_retry C
  echo "BRAMKA C (wizualna) — $TASK · routes: $ROUTES"
  PW="$ROOT/node_modules/.bin/playwright"; command -v playwright >/dev/null 2>&1 && PW="playwright"
  if ! [ -x "$PW" ] && ! command -v playwright >/dev/null 2>&1; then
    echo "  ⚠ playwright niedostępny — bramka C: SKIPPED (ocena wizualna ręczna)."
    echo "    włączenie: npm i -D playwright && npx playwright install chromium"
    tlm "$(printf '{"ts":"%s","typ":"gate","bramka":"C","task":"%s","wynik":"SKIPPED"}' "$(NOW)" "$TASK")"
    exit 2
  fi
  local reasons="" shots=0 safe out
  if ! start_server; then gate_fail C "serwer nie wystartował"; fi
  IFS=',' read -r -a RARR <<< "$ROUTES"
  for r in "${RARR[@]}"; do
    safe="$(printf '%s' "$r" | tr '/?' '__')"
    for vp in 390x844 1440x900; do
      out="$ART/shot_${TASK}_${safe}_${vp}.png"
      if "$PW" screenshot --viewport-size="${vp/x/,}" "$BASE_URL$r" "$out" >/dev/null 2>&1 && [ -s "$out" ]; then
        shots=$((shots+1)); echo "  • ${out#$STATE/}"
      else
        reasons="${reasons}screenshot $r @$vp: FAIL"$'\n'
      fi
    done
  done
  stop_server
  if [ -z "$reasons" ]; then
    gate_pass C "screenshoty: $shots → ocena: ślepy Recenzent"
  else
    gate_fail C "$reasons"
  fi
}

# ── metrics: events.jsonl → protocol-metrics.json ────────────────────────────
gate_metrics() {
  local EV="$STATE/telemetry/events.jsonl" OUT="$STATE/telemetry/protocol-metrics.json"
  [ -f "$EV" ] || { echo '{"info":"brak zdarzeń"}' > "$OUT"; echo "metrics: brak zdarzeń — zapisano pusty $OUT"; return 0; }
  if command -v node >/dev/null 2>&1; then
    node -e "
const fs=require('fs');
const lines=fs.readFileSync(process.argv[1],'utf8').split(/\n/).filter(Boolean);
const ev=lines.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);
const m={wersja:'1.0-S',zdarzen:ev.length,preflight:{uruchomien:0,fail:0,warn:0},bramki:{},fail_total:0,eskalacje:0,detektory_dodane:0,fail_wg_kategorii:{},iteracje:{suma:0,fail_count:0},ostatnie:ev.length?ev[ev.length-1].ts:null};
for(const e of ev){
 if(e.typ==='preflight'){m.preflight.uruchomien++;m.preflight.fail+=e.fail||0;m.preflight.warn+=e.warn||0;
  if(e.fail_ids)for(const id of e.fail_ids.split(',').filter(Boolean)){const k=(id.match(/^P-([A-H])/)||[])[1]||'?';m.fail_wg_kategorii[k]=(m.fail_wg_kategorii[k]||0)+1;}}
 if(e.typ==='gate'){const b=e.bramka||'?';m.bramki[b]=m.bramki[b]||{pass:0,fail:0,skipped:0};
  if(e.wynik==='PASS')m.bramki[b].pass++;else if(e.wynik==='FAIL'){m.bramki[b].fail++;m.fail_total++;m.iteracje.suma+=e.iteracja||0;m.iteracje.fail_count++;}else m.bramki[b].skipped++;}
 if(e.typ==='eskalacja')m.eskalacje++;
 if(e.typ==='pitfall'){m.detektory_dodane++;const k=e.kategoria||'?';}
 // Stan REJESTRU, nie historia dopisan: `detektory_dodane` liczy zdarzenia i obejmuje
 // wpisy pozniej wycofane, wiec cytowany samodzielnie klamie o pokryciu.
 if(e.typ==='preflight'&&e.wykonane!==undefined)
  m.detektory_stan={wykonywane:e.wykonane,pominiete:e.pominiete||0,wycofane:e.wycofane||0,
   w_rejestrze:(e.wykonane||0)+(e.pominiete||0)+(e.wycofane||0)};
}
m.iteracje_srednio=m.iteracje.fail_count?+(m.iteracje.suma/m.iteracje.fail_count).toFixed(2):0;
delete m.iteracje;
fs.writeFileSync(process.argv[2],JSON.stringify(m,null,2)+'\n');
console.log('metrics: zapisano',process.argv[2],'('+ev.length+' zdarzeń)');
" "$EV" "$OUT"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$EV" "$OUT" <<'PY'
import json,sys
ev=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
m={"wersja":"1.0-S","zdarzen":len(ev),"preflight":{"uruchomien":0,"fail":0,"warn":0},
   "bramki":{},"fail_total":0,"eskalacje":0,"detektory_dodane":0,"fail_wg_kategorii":{},
   "ostatnie":ev[-1]["ts"] if ev else None}
s=c=0
for e in ev:
    t=e.get("typ")
    if t=="preflight":
        m["preflight"]["uruchomien"]+=1;m["preflight"]["fail"]+=e.get("fail",0);m["preflight"]["warn"]+=e.get("warn",0)
        for i in filter(None,e.get("fail_ids","").split(",")):
            k=i[2:3] if i.startswith("P-") else "?";m["fail_wg_kategorii"][k]=m["fail_wg_kategorii"].get(k,0)+1
    elif t=="gate":
        b=m["bramki"].setdefault(e.get("bramka","?"),{"pass":0,"fail":0,"skipped":0})
        w=e.get("wynik")
        if w=="PASS":b["pass"]+=1
        elif w=="FAIL":b["fail"]+=1;m["fail_total"]+=1;s+=e.get("iteracja",0);c+=1
        else:b["skipped"]+=1
    elif t=="eskalacja":m["eskalacje"]+=1
    elif t=="pitfall":m["detektory_dodane"]+=1
    if t=="preflight" and e.get("wykonane") is not None:
        m["detektory_stan"]={"wykonywane":e.get("wykonane",0),"pominiete":e.get("pominiete",0),
                             "wycofane":e.get("wycofane",0),
                             "w_rejestrze":e.get("wykonane",0)+e.get("pominiete",0)+e.get("wycofane",0)}
m["iteracje_srednio"]=round(s/c,2) if c else 0
json.dump(m,open(sys.argv[2],"w"),indent=2,ensure_ascii=False);print("metrics: zapisano",sys.argv[2],f"({len(ev)} zdarzeń)")
PY
  else
    echo "metrics: brak node i python3 — pomiń albo doinstaluj jedno z nich" >&2; return 1
  fi
}

case "$MODE" in
  A)       gate_A ;;
  B)       gate_B ;;
  C)       gate_C ;;
  task)    gate_A; gate_B ;;
  metrics) gate_metrics ;;
  *) echo "gate.sh: nieznany tryb '$MODE' (A|B|C|task|metrics)" >&2; exit 64 ;;
esac
