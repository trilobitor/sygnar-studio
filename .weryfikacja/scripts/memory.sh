#!/usr/bin/env bash
# AiOS Fazowy — PAMIĘĆ ZADAŃ (decyzja 18)
#
#   memory.sh recall  "<opis zadania>" [--stack S] [--limit N] [--projekt P|--all] [--json]
#   memory.sh commit  <TASK> [--projekt P] [--antywzorzec "powod"]
#   memory.sh reindex [--projekt P]        odbudowa bazy z repo (baza = indeks, nie źródło)
#   memory.sh stats                        pokrycie, rozmiar, tryb pracy
#   memory.sh doctor                       diagnostyka WARSTWY: pgvector (CVE), embedder, schemat
#   memory.sh doctor --korpus              kontrola TREŚCI: baza kontra repo kontra telemetria
#
# Konfiguracja: .hait/hait.config.json (klucz `pamiec` + `stack`).
# Zmienne AIOS_* nadpisują config; config nadpisuje wartości domyślne.
#
# ZASADA NADRZĘDNA — płaszczyzna OSĄDU, nie faktu:
#   Żadna bramka nie wywołuje tego skryptu. Wynik `recall` jest podpowiedzią
#   dla Architekta i Arbitra, nigdy predykatem przejścia fazy. Jeśli kiedykolwiek
#   pojawi się pokusa, by gate.sh pytał pamięć — to znak, że coś poszło źle.
#
# ZASADA DRUGA — referencje, nie treść:
#   `recall` zwraca ŚCIEŻKI i METRYKI. Architekt musi świadomie otworzyć plik.
#   Cel: precedens ma być przeczytany i zrozumiany, nie skopiowany.
#
# TRZY POZIOMY DEGRADACJI — pamięć NIGDY nie blokuje protokołu:
#   pełny      (0)  Postgres + embedder  → wektor × filtr SQL × waga jakości/wieku
#   zdegradowany(69) Postgres bez embeddera → pełnotekstowo (FTS), uczciwie zgłoszone
#   awaryjny   (69) brak Postgresa        → grep po docs/ w repo
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${AIOS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
. "$SCRIPT_DIR/lib/aios-root.sh" 2>/dev/null || { echo "memory.sh: brak scripts/lib/aios-root.sh — powłoka niekompletna" >&2; exit 78; }
STATE="$(aios_state_root "$ROOT")"
CONFIG="${AIOS_CONFIG:-$ROOT/.hait/hait.config.json}"

# ── Konfiguracja: zmienna środowiskowa > .hait/hait.config.json > domyślna ────
# Config deklaruje wprost: „Nic w skillach ani skryptach nie jest zahardkodowane
# — wszystko czyta się stąd". Ten skrypt tej zasady wcześniej nie honorował
# i rozjechał się z configiem na nazwie bazy (hait_memory vs aios_memory).
# Środowisko zostaje nadrzędne, bo CI musi móc wskazać inną instancję.
cfg() { # $1 = ścieżka kropkowa, $2 = wartość domyślna
  [ -f "$CONFIG" ] || { printf '%s' "$2"; return 0; }
  python3 - "$CONFIG" "$1" "$2" <<'PY' 2>/dev/null || printf '%s' "$2"
import json,sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    for k in sys.argv[2].split("."):
        d = d[k]
    print("" if d is None else d, end="")
except Exception:
    print(sys.argv[3], end="")
PY
}

DB_HOST="${AIOS_DB_HOST:-$(cfg pamiec.host localhost)}"
DB_PORT="${AIOS_DB_PORT:-$(cfg pamiec.port 5433)}"
DB_NAME="${AIOS_DB_NAME:-$(cfg pamiec.baza aios_memory)}"
DB_USER="${AIOS_DB_USER:-$(cfg pamiec.uzytkownik aios)}"
DB_PASS="${AIOS_DB_PASS:-aios_local_dev}"
# ── Profil embeddera ─────────────────────────────────────────────────────────
# Dwa wspierane backendy, wybierane polem `pamiec.embedder.aktywny`:
#   ollama (DOMYSLNY) — kontener docker, przenosny, /api/embed
#   tei              — text-embeddings-inference, natywny Metal na Apple Silicon,
#                      POZA Dockerem (kontener nie ma dostepu do GPU Apple), /embed
# Roznica nie sprowadza sie do adresu: inny jest ksztalt zadania, ksztalt
# odpowiedzi, endpoint zdrowia ORAZ WYMIAR WEKTORA — a wymiar jest wpisany
# w kolumne `embedding vector(N)` i w indeks HNSW. Dlatego `doctor` porownuje
# wymiar zadeklarowany, faktyczny i ten w bazie; rozjazd musi byc glosny.
EMBED_PROFIL="${AIOS_EMBED_PROFIL:-$(cfg pamiec.embedder.aktywny ollama-docker)}"
EMBED_BACKEND="${AIOS_EMBED_BACKEND:-$(cfg "pamiec.embedder.profile.${EMBED_PROFIL}.backend" ollama)}"
EMBED_URL="${AIOS_EMBED_URL:-$(cfg "pamiec.embedder.profile.${EMBED_PROFIL}.url" http://localhost:11435)}"
EMBED_MODEL="${AIOS_EMBED_MODEL:-$(cfg "pamiec.embedder.profile.${EMBED_PROFIL}.model" embeddinggemma)}"
EMBED_DIM="${AIOS_EMBED_DIM:-$(cfg "pamiec.embedder.profile.${EMBED_PROFIL}.wymiar" 768)}"
EMBED_START="$(cfg "pamiec.embedder.profile.${EMBED_PROFIL}.uruchomienie" "docker compose --profile embed up -d")"
# zgodnosc wstecz: stara nazwa zmiennej nadal dziala
OLLAMA_URL="${AIOS_OLLAMA_URL:-$EMBED_URL}"
[ -n "${AIOS_OLLAMA_URL:-}" ] && EMBED_URL="$AIOS_OLLAMA_URL"
PROJEKT_DEFAULT="${AIOS_PROJEKT:-$(basename "$ROOT")}"
STACK_DEFAULT="${AIOS_STACK:-$(cfg stack nieokreslony)}"

export PGPASSWORD="$DB_PASS"
PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt)

now()  { date -Iseconds; }
warn() { printf '%s\n' "$*" >&2; }

sql_lit() { printf "%s" "$1" | sed "s/'/''/g"; }   # cudzysłów SQL

# ── Telemetria ───────────────────────────────────────────────────────────────
# Argumenty to pary klucz wartość; wartości uciekane przez json.dumps.
# Wcześniej pole `zapytanie` przechodziło przez sql_lit (ucieka apostrof, nie
# cudzysłów) i wprost do JSON-a — zapytanie z " wpisywało uszkodzoną linię do
# events.jsonl, czyli tego samego pliku, z którego bramka liczy metryki.
# Parser pomijał ją po cichu, więc defekt nie miał jak się ujawnić.
tlm() { # tlm typ=recall tryb=fts trafien:=3   (`:=` = wartość surowa, bez cudzysłowów)
  mkdir -p "$STATE/telemetry"
  python3 - "$(now)" "$@" >> "$STATE/telemetry/events.jsonl" <<'PY'
import json,sys
o = {"ts": sys.argv[1]}
for a in sys.argv[2:]:
    k, _, v = a.partition("=")          # dzielimy na PIERWSZYM '='
    if k.endswith(":"):                 # klucz z ':' na końcu => wartość surowa
        k = k[:-1]
        try:    o[k] = json.loads(v)
        except ValueError: o[k] = v
    else:
        o[k] = v
print(json.dumps(o, ensure_ascii=False))
PY
}

# ── wykrywanie dostępności warstw ────────────────────────────────────────────
has_db() {
  command -v psql >/dev/null 2>&1 || return 1
  "${PSQL[@]}" -c 'SELECT 1' >/dev/null 2>&1
}
has_embed() {
  command -v curl >/dev/null 2>&1 || return 1
  case "$EMBED_BACKEND" in
    tei) curl -sf --max-time 3 "$EMBED_URL/health"   >/dev/null 2>&1 ;;
    *)   curl -sf --max-time 3 "$EMBED_URL/api/tags" >/dev/null 2>&1 ;;
  esac
}

# ── embedding ────────────────────────────────────────────────────────────────
# Zwraca wektor w formacie pgvector: [0.1,0.2,...]. Pusty output = porażka.
# Dwa backendy roznia sie ksztaltem w KAZDYM z trzech miejsc:
#   endpoint         ollama /api/embed        · tei /embed
#   pole wejscia     {"model":…,"input":…}    · {"inputs":…}
#   ksztalt wyjscia  {"embeddings":[[…]]}     · [[…]]
# Parser wyjscia obsluguje oba ksztalty jednym kodem, bo to tansze niz dwie
# sciezki, ktore trzeba utrzymywac rownolegle.
embed() {
  local text="$1" body out url
  case "$EMBED_BACKEND" in
    tei)
      url="$EMBED_URL/embed"
      body="$(python3 -c 'import json,sys; print(json.dumps({"inputs":sys.argv[1]}))' \
              "$text" 2>/dev/null)" || return 1
      ;;
    *)
      url="$EMBED_URL/api/embed"
      body="$(python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"input":sys.argv[2]}))' \
              "$EMBED_MODEL" "$text" 2>/dev/null)" || return 1
      ;;
  esac
  out="$(curl -sf --max-time 60 "$url" \
          -H 'Content-Type: application/json' -d "$body" 2>/dev/null)" || return 1
  printf '%s' "$out" | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
    if isinstance(d, dict):                       # ollama: {"embeddings":[[…]]}
        v = d.get("embeddings") or d.get("embedding")
    else:                                         # tei: [[…]]
        v = d
    if v and isinstance(v[0], list): v = v[0]
    if not v: sys.exit(1)
    print("[" + ",".join(f"{x:.6f}" for x in v) + "]")
except Exception:
    sys.exit(1)
' 2>/dev/null
}

# Faktyczny wymiar zwracany przez dzialajacy embedder — do kontroli zgodnosci
# z kolumna w bazie. Deklaracja w configu bywa nieprawdziwa; ta funkcja mierzy.
embed_wymiar_faktyczny() {
  local v; v="$(embed "kontrola wymiaru" 2>/dev/null || true)"
  [ -n "$v" ] || return 1
  printf '%s' "$v" | tr ',' '\n' | grep -c .
}

# ── odczyt metryk zadania z telemetrii ───────────────────────────────────────
# Źródłem jest events.jsonl — ten sam plik, który czyta gate.sh metrics.
# Pamięć nie wymyśla własnych liczb; czyta te, które już istnieją.
metryki_zadania() { # $1 = TASK -> "fail|iter|esk|detektory"
  local task="$1" ev="$STATE/telemetry/events.jsonl"
  [ -f "$ev" ] || { printf '0|0|0|'; return 0; }
  python3 - "$ev" "$task" <<'PY'
import json,re,sys
ev_path, task = sys.argv[1], sys.argv[2]

# Przypisanie detektora do zadania idzie po nazwie pliku RCA (`zrodlo`),
# np. RCA_T-ABC-3_faza7_1.md. Dopasowanie MUSI być kotwiczone.
#
# Wcześniej było `task in zrodlo`, czyli zwykły podciąg — a identyfikatory
# tworzą tu rodzinę z prefiksem: "T-ABC" jest podciągiem "T-ABC-3" i "T-ABC-5".
# Skutek był jednokierunkowy i systematyczny: każde zadanie bazowe zaciągało
# detektory wszystkich swoich delt. T-ABC pokazywał 11 detektorów, z czego
# własnych miał 5 — a to jest dokładnie ta liczba, którą Architekt czyta jako
# „ile ten precedens nauczył system".
#
# Granica: po identyfikatorze nie może stać znak, który mógłby go przedłużyć
# (litera, cyfra, myślnik). "RCA_T-ABC_..." → po "T-ABC" jest "_" → trafienie.
# "RCA_T-ABC-3_..." → po "T-ABC" jest "-" → brak trafienia. O to chodzi.
granica = re.compile(r'(?:^|[^0-9A-Za-z-])' + re.escape(task) + r'(?![0-9A-Za-z-])')

fail = esk = 0
it_sum = it_n = 0
det = []
for line in open(ev_path, encoding="utf-8"):
    line = line.strip()
    if not line: continue
    try: e = json.loads(line)
    except ValueError: continue
    t = e.get("typ")
    if t == "pitfall":
        # zdarzenia pitfall nie niosą pola `task` — wiąże je nazwa pliku RCA
        if granica.search(str(e.get("zrodlo", ""))):
            det.append(e.get("id", ""))
        continue
    if e.get("task") != task:
        continue
    if t == "gate" and e.get("wynik") == "FAIL":
        fail += 1; it_sum += e.get("iteracja", 0); it_n += 1
    elif t == "eskalacja":
        esk += 1

# Deduplikacja z zachowaniem kolejności pierwszego wystąpienia. Ten sam
# detektor bywa zgłoszony wielokrotnie (ponowne uruchomienie bramki po
# poprawce); pamięć ma liczyć RÓŻNE detektory, nie zdarzenia.
widziane = set()
unik = [d for d in det if d and not (d in widziane or widziane.add(d))]
print(f"{fail}|{round(it_sum/it_n,2) if it_n else 0}|{esk}|{','.join(unik)}")
PY
}

# ── RECALL ───────────────────────────────────────────────────────────────────
cmd_recall() {
  local query="" stack="" limit=3 projekt="$PROJEKT_DEFAULT" all=0 json=0
  query="${1:-}"; [ -n "$query" ] && shift || { warn "memory.sh recall: podaj opis zadania"; exit 64; }
  while [ $# -gt 0 ]; do
    case "$1" in
      --stack)   stack="$2"; shift 2 ;;
      --limit)   limit="$2"; shift 2 ;;
      --projekt) projekt="$2"; shift 2 ;;
      --all)     all=1; shift ;;
      --json)    json=1; shift ;;
      *) warn "memory.sh recall: nieznana opcja: $1"; exit 64 ;;
    esac
  done
  case "$limit" in ''|*[!0-9]*) warn "memory.sh: --limit musi być liczbą"; exit 64 ;; esac

  local where="WHERE TRUE"
  [ "$all" -eq 0 ] && where="$where AND projekt = '$(sql_lit "$projekt")'"
  [ -n "$stack" ]  && where="$where AND stack   = '$(sql_lit "$stack")'"

  # ── poziom awaryjny: brak bazy ─────────────────────────────────────────────
  if ! has_db; then
    warn "⚠ memory: brak połączenia z bazą ($DB_HOST:$DB_PORT) — TRYB AWARYJNY (grep po docs/)."
    warn "  uruchomienie: docker compose up -d postgres"
    local hits
    hits="$(grep -ril --include='*.md' -- "$query" "$ROOT/docs" 2>/dev/null | head -"$limit" || true)"
    if [ -z "$hits" ]; then
      echo "brak precedensów (tryb awaryjny — przeszukano docs/ tekstowo)"
    else
      echo "PRECEDENSY (tryb awaryjny — dopasowanie tekstowe, bez rankingu):"
      printf '%s\n' "$hits" | sed "s|^$ROOT/|  · |"
    fi
    tlm typ=recall tryb=awaryjny zapytanie="$query" \
        # `awk`, nie `grep -c`: przy zerze trafien `grep -c` wypisuje 0 ORAZ konczy sie
        # kodem 1, wiec `|| echo 0` doklejalo DRUGIE zero i pole `trafien` w telemetrii
        # zawieralo doslownie "0\n0". Zmierzone 2026-09-02 na dwoch zdarzeniach `recall`
        # (2026-08-13, 2026-09-01). `awk` zawsze wypisuje jedna liczbe i zawsze konczy sie
        # kodem 0, wiec konstrukcja awaryjna przestaje byc potrzebna.
        "trafien:=$(printf '%s' "$hits" | awk 'NF{c++} END{print c+0}')"
    exit 69
  fi

  # ── poziom pełny albo zdegradowany ─────────────────────────────────────────
  local vec="" tryb="fts" rc=0
  if has_embed; then
    vec="$(embed "$query" || true)"
    [ -n "$vec" ] && tryb="wektor"
  fi
  if [ "$tryb" = "fts" ]; then
    warn "⚠ memory: embedder niedostępny — profil '$EMBED_PROFIL' ($EMBED_BACKEND @ $EMBED_URL)."
    warn "  wyszukiwanie PEŁNOTEKSTOWE, nie semantyczne. Uruchomienie: $EMBED_START"
    rc=69
  fi

  local sql
  if [ "$tryb" = "wektor" ]; then
    # Hybryda: podobieństwo × waga jakości × waga wieku.
    # Iteracyjne skanowanie indeksu (pgvector >= 0.8) chroni przed
    # nadmiernym filtrowaniem przy wąskim WHERE.
    sql="SET LOCAL hnsw.iterative_scan = relaxed_order;
      SELECT task_id, projekt, tytul, stack, to_char(dostarczono,'YYYY-MM-DD'),
             round((1 - (embedding <=> '$vec'))::numeric, 3),
             round(w_jakosc, 2), round(w_wiek, 2),
             round(((1 - (embedding <=> '$vec')) * w_jakosc * w_wiek)::numeric, 3),
             fail_total, eskalacje, coalesce(ref_kontrakt,'—'), coalesce(ref_delivery,'—'),
             array_to_string(detektory_dodane, ','), antywzorzec
      FROM zadania_ranking
      $where AND embedding IS NOT NULL
      ORDER BY 9 DESC
      LIMIT $limit;"
  else
    # Tryb zdegradowany na polskim korpusie — dwa uzupełniające się sygnały
    # (uzasadnienie i ograniczenia przy konfiguracji `polski` w schemacie):
    #   ts_rank na `polski` (simple + unaccent) — trafienie w słowo, także
    #     napisane bez diakrytyki; normalizacja 32 sprowadza wynik do (0,1),
    #     bez niej surowy ts_rank (~0.06) jest nieporównywalny z podobieństwem
    #   word_similarity — trigram, jedyny nośnik fleksji: „odświeżanie"
    #     kontra „odświeżania" dzielą większość trigramów, a stemmera dla
    #     polskiego PostgreSQL nie ma
    # Bierzemy GREATEST, nie sumę: to alternatywne drogi do tego samego
    # trafienia, więc dokładne dopasowanie nie ma być premiowane podwójnie.
    sql="SET LOCAL pg_trgm.word_similarity_threshold = 0.45;
      WITH q AS (SELECT plainto_tsquery('polski','$(sql_lit "$query")') AS tsq,
                        '$(sql_lit "$query")'::text                      AS raw)
      SELECT task_id, projekt, tytul, stack, to_char(dostarczono,'YYYY-MM-DD'),
             round(GREATEST(ts_rank(fts, q.tsq, 32),
                            word_similarity(q.raw, szukaj))::numeric, 3),
             round(w_jakosc, 2), round(w_wiek, 2),
             round((GREATEST(ts_rank(fts, q.tsq, 32),
                             word_similarity(q.raw, szukaj)) * w_jakosc * w_wiek)::numeric, 3),
             fail_total, eskalacje, coalesce(ref_kontrakt,'—'), coalesce(ref_delivery,'—'),
             array_to_string(detektory_dodane, ','), antywzorzec
      FROM zadania_ranking, q
      $where AND (fts @@ q.tsq OR q.raw <% szukaj)
      ORDER BY 9 DESC
      LIMIT $limit;"
  fi

  local out
  out="$("${PSQL[@]}" -F'|' -c "$sql" 2>/dev/null || true)"

  if [ "$json" -eq 1 ]; then
    printf '%s' "$out" | python3 -c '
import sys,json
k=["task_id","projekt","tytul","stack","dostarczono","podobienstwo","w_jakosc","w_wiek",
   "wynik","fail_total","eskalacje","ref_kontrakt","ref_delivery","detektory_dodane","antywzorzec"]
r=[dict(zip(k,l.split("|"))) for l in sys.stdin.read().splitlines() if l.strip()]
print(json.dumps({"tryb":sys.argv[1],"trafien":len(r),"precedensy":r},ensure_ascii=False,indent=2))
' "$tryb"
  else
    if [ -z "$out" ]; then
      echo "PRECEDENSY: brak (tryb: $tryb) — zadanie bez historii, projektuj od zera."
    else
      echo "PRECEDENSY (tryb: $tryb · ranking = podobieństwo × jakość × świeżość):"
      printf '%s\n' "$out" | while IFS='|' read -r tid proj tyt stk dat sim jak wiek sc ft esk kon del det anty; do
        printf '\n  [%s] %s · %s · %s · %s\n' "$tid" "$tyt" "$proj" "$stk" "$dat"
        printf '      wynik %s (podob. %s × jakość %s × świeżość %s) · FAIL %s · eskalacje %s%s\n' \
               "$sc" "$sim" "$jak" "$wiek" "$ft" "$esk" \
               "$([ "$anty" = "t" ] && printf ' · ⚠ ANTYWZORZEC' || true)"
        printf '      kontrakt:  %s\n' "$kon"
        printf '      delivery:  %s\n' "$del"
        [ -n "$det" ] && printf '      detektory: %s\n' "$det"
      done
      echo ""
      echo "  → Przeczytaj kontrakty przed projektowaniem. NIE kopiuj — precedens to wejście do osądu,"
      echo "    nie szablon. Rozbieżność z bieżącym zadaniem odnotuj w ADR."
    fi
  fi

  local ids
  ids="$(printf '%s' "$out" | cut -d'|' -f1 | paste -sd ',' - 2>/dev/null || true)"
  tlm typ=recall tryb="$tryb" zapytanie="$query" \
      "trafien:=$(printf '%s' "$out" | awk 'NF{c++} END{print c+0}')" zwrocone="$ids"
  "${PSQL[@]}" -c "INSERT INTO recall_log(projekt,zapytanie,tryb,trafien,zwrocone_ids)
      VALUES('$(sql_lit "$projekt")','$(sql_lit "$query")','$tryb',
             $(printf '%s' "$out" | awk 'NF{c++} END{print c+0}'),
             string_to_array('$(sql_lit "$ids")',','));" >/dev/null 2>&1 || true
  exit $rc
}

# ── COMMIT ───────────────────────────────────────────────────────────────────
cmd_commit() {
  local task="${1:-}" projekt="$PROJEKT_DEFAULT" anty="" antypowod=""
  [ -n "$task" ] && shift || { warn "memory.sh commit: podaj TASK_ID"; exit 64; }
  while [ $# -gt 0 ]; do
    case "$1" in
      --projekt)     projekt="$2"; shift 2 ;;
      --antywzorzec) anty="true"; antypowod="$2"; shift 2 ;;
      *) warn "memory.sh commit: nieznana opcja: $1"; exit 64 ;;
    esac
  done
  has_db || { warn "memory.sh commit: brak bazy — zapis niemożliwy. Po starcie bazy: memory.sh reindex"; exit 66; }

  # Warunek zapisu: zadanie DOSTARCZONE. Pamięć przechowuje rzeczy ukończone
  # i zweryfikowane bramkami, nie próby. Protokół ma własny predykat prawdy —
  # używamy go jako filtra jakości korpusu, zamiast wymyślać nowy.
  local delivery=""
  for c in "$ROOT/DELIVERY_${task}.md" "$ROOT/docs/DELIVERY_${task}.md" "$ROOT/DELIVERY.md"; do
    [ -f "$c" ] && { delivery="$c"; break; }
  done
  if [ -z "$delivery" ]; then
    warn "✗ memory.sh commit: brak DELIVERY dla $task — pamięć przyjmuje wyłącznie zadania DOSTARCZONE."
    warn "  (szukano: DELIVERY_${task}.md, docs/DELIVERY_${task}.md, DELIVERY.md)"
    exit 66
  fi

  # Szablon nie jest zadaniem. docs/DELIVERY_TEMPLATE.md pasuje do globu
  # w `reindex` i wcześniej trafiał do korpusu jako wpis „DELIVERY — {{TASK}}
  # ({{DATE}})", gotowy do zwrócenia przez recall jako precedens.
  # Test po niewypełnionych symbolach zastępczych, nie po nazwie pliku —
  # łapie także szablon skopiowany pod inną nazwą i rozpoczęte, lecz
  # niedokończone DELIVERY.
  if grep -q '{{[A-Za-z_]*}}' "$delivery" 2>/dev/null; then
    warn "✗ memory.sh commit: $delivery zawiera niewypełnione symbole {{...}} — to szablon, nie dostarczenie."
    warn "  pamięć przyjmuje wyłącznie ukończone manifesty."
    exit 66
  fi

  local brief="$ROOT/docs/briefs/${task}.md"
  local kontrakt="$ROOT/docs/contracts/${task}.kontrakt.md"
  local filemap="$ROOT/docs/contracts/${task}.filemap"
  local postmortem=""
  for c in "$ROOT/docs/POSTMORTEM_${task}.md" "$ROOT/docs/postmortem/${task}.md"; do
    [ -f "$c" ] && { postmortem="$c"; break; }
  done

  local tytul streszczenie dod klas stack dostarczono

  # ── Tytuł ──────────────────────────────────────────────────────────────────
  # H1 manifestu to „DELIVERY — T-ABC-2 (2026-08-07)" — sama tożsamość, zero
  # treści, a tytuł wchodzi do wektora i do FTS. Linia `- zadanie:` niesie
  # opis właściwy („moduł ABC: czas w trybie ciągłym…"), więc bierzemy ją
  # pierwszą, a H1 zostaje ostatecznym ratunkiem.
  tytul="$(sed -n 's/^- zadanie:[[:space:]]*//p' "$delivery" 2>/dev/null | head -1 || true)"
  if [ -z "$tytul" ] && [ -f "$brief" ]; then
    tytul="$(sed -n 's/^# *BRIEF[[:space:]]*—[[:space:]]*//p' "$brief" 2>/dev/null | head -1 || true)"
  fi
  [ -n "$tytul" ] || tytul="$(grep -m1 '^# ' "$delivery" 2>/dev/null | sed 's/^# *//' || true)"
  [ -n "$tytul" ] || tytul="$task"

  # ── Data dostarczenia ──────────────────────────────────────────────────────
  # Kolumna miała DEFAULT now(), a ON CONFLICT nadpisywał ją przez now() —
  # więc każdy `reindex` cofał wiek CAŁEGO korpusu na dzisiaj i `waga_wieku`
  # mnożyła przez stałą 1.00. Funkcja z półtrwaniem 18 miesięcy i podłogą 0.40
  # była starannie skalibrowana i całkowicie martwa.
  # Data jest w H1 manifestu; gdy jej brak — data zatwierdzenia pliku w gicie;
  # dopiero na końcu dzisiaj (i wtedy mówimy o tym wprost).
  dostarczono="$(sed -n '1s/.*(\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)).*/\1/p' "$delivery" 2>/dev/null || true)"
  if [ -z "$dostarczono" ]; then
    dostarczono="$(git -C "$ROOT" log -1 --format=%as -- "$delivery" 2>/dev/null || true)"
    [ -n "$dostarczono" ] && warn "⚠ memory: $task — brak daty w nagłówku DELIVERY, użyto daty commitu ($dostarczono)"
  fi
  if [ -z "$dostarczono" ]; then
    dostarczono="$(date +%F)"
    warn "⚠ memory: $task — nie ustalono daty dostarczenia, użyto dzisiejszej ($dostarczono). Waga wieku będzie zawyżona."
  fi
  if [ -f "$brief" ]; then
    streszczenie="$(sed -e 's/^#\+ *//' -e 's/[*_`]//g' "$brief" | grep -v '^\s*$' | head -25 | tr '\n' ' ')"
  else
    streszczenie="$(sed -e 's/^#\+ *//' -e 's/[*_`]//g' "$delivery" | grep -v '^\s*$' | head -25 | tr '\n' ' ')"
  fi
  dod="$(awk '/[Kk]ryteria [Oo]dbioru|DoD/{f=1} f&&/^[-*] /{print} /^## /&&f&&!/[Kk]ryteria|DoD/{f=0}' \
         "$delivery" 2>/dev/null | head -15 | tr '\n' ' ' || true)"
  klas="SKROCONY"; grep -qiE 'PELNY|PEŁNY|9 faz' "$delivery" 2>/dev/null && klas="PELNY"

  # Stack czytany z configu (pole `stack`), z możliwością nadpisania przez
  # AIOS_STACK. Wcześniej brał się WYŁĄCZNIE ze zmiennej środowiskowej, której
  # nikt nie ustawiał — wszystkie wiersze miały 'nieokreslony', więc filtr
  # `--stack` nie odsiewał niczego. To nie kosmetyka: schemat celowo nie karze
  # precedensu za wiek, bo od niedopasowania wersji ma być ten filtr.
  stack="$STACK_DEFAULT"
  [ -n "$stack" ] || stack="nieokreslony"
  [ "$stack" = "nieokreslony" ] && warn "⚠ memory: $task — stack nieokreślony (ustaw pole \`stack\` w $CONFIG). Filtr --stack nie będzie działał."

  local m fail iter esk det
  m="$(metryki_zadania "$task")"
  fail="${m%%|*}"; m="${m#*|}"; iter="${m%%|*}"; m="${m#*|}"; esk="${m%%|*}"; det="${m#*|}"

  local vec="NULL"
  if has_embed; then
    local v; v="$(embed "$tytul. $streszczenie $dod" || true)"
    [ -n "$v" ] && vec="'$v'"
  fi
  [ "$vec" = "NULL" ] && warn "⚠ memory: zapis BEZ wektora (brak embeddera) — wpis wyszukiwalny tylko pełnotekstowo. Po uruchomieniu embeddera: memory.sh reindex"

  local rel_del="${delivery#$ROOT/}" rel_kon="—" rel_fm="—" rel_br="—" rel_pm="—"
  [ -f "$kontrakt" ]   && rel_kon="${kontrakt#$ROOT/}"
  [ -f "$filemap" ]    && rel_fm="${filemap#$ROOT/}"
  [ -f "$brief" ]      && rel_br="${brief#$ROOT/}"
  [ -n "$postmortem" ] && rel_pm="${postmortem#$ROOT/}"

  local detarr="'{}'"
  [ -n "$det" ] && detarr="string_to_array('$(sql_lit "$det")',',')"

  "${PSQL[@]}" -c "
    INSERT INTO zadania(projekt,task_id,tytul,klasyfikacja,stack,dostarczono,brief_streszczenie,dod,
      ref_brief,ref_kontrakt,ref_filemap,ref_delivery,ref_postmortem,
      fail_total,iteracje_srednio,eskalacje,detektory_dodane,embedding,
      antywzorzec,antywzorzec_powod)
    VALUES('$(sql_lit "$projekt")','$(sql_lit "$task")','$(sql_lit "$tytul")','$klas','$(sql_lit "$stack")',
      '$(sql_lit "$dostarczono")'::timestamptz,
      '$(sql_lit "$streszczenie")','$(sql_lit "$dod")',
      '$(sql_lit "$rel_br")','$(sql_lit "$rel_kon")','$(sql_lit "$rel_fm")','$(sql_lit "$rel_del")','$(sql_lit "$rel_pm")',
      $fail,$iter,$esk,$detarr,$vec,
      ${anty:-false},$([ -n "$antypowod" ] && printf "'%s'" "$(sql_lit "$antypowod")" || printf 'NULL'))
    ON CONFLICT (projekt,task_id) DO UPDATE SET
      tytul=EXCLUDED.tytul, stack=EXCLUDED.stack, klasyfikacja=EXCLUDED.klasyfikacja,
      brief_streszczenie=EXCLUDED.brief_streszczenie, dod=EXCLUDED.dod,
      ref_brief=EXCLUDED.ref_brief, ref_kontrakt=EXCLUDED.ref_kontrakt, ref_filemap=EXCLUDED.ref_filemap,
      ref_delivery=EXCLUDED.ref_delivery, ref_postmortem=EXCLUDED.ref_postmortem,
      fail_total=EXCLUDED.fail_total, iteracje_srednio=EXCLUDED.iteracje_srednio,
      eskalacje=EXCLUDED.eskalacje, detektory_dodane=EXCLUDED.detektory_dodane,
      embedding=COALESCE(EXCLUDED.embedding, zadania.embedding),
      antywzorzec=EXCLUDED.antywzorzec, antywzorzec_powod=EXCLUDED.antywzorzec_powod,
      -- data z manifestu, NIE now(): reindeks jest odbudową indeksu,
      -- a nie zdarzeniem, które odmładza precedens
      dostarczono=EXCLUDED.dostarczono;" >/dev/null || { warn "✗ memory.sh commit: zapis nieudany"; exit 66; }

  echo "✓ pamięć: zapisano $task ($projekt) · $dostarczono · stack $stack"
  echo "  FAIL $fail · iteracje śr. $iter · eskalacje $esk${det:+ · detektory: $det}"
  [ "$vec" != "NULL" ] && echo "  wektor: tak (wymiar $EMBED_DIM)" || echo "  wektor: BRAK — wyszukiwalne pełnotekstowo"
  [ -n "$anty" ] && echo "  ⚠ oznaczone jako ANTYWZORZEC: $antypowod"
  tlm typ=memory_commit task="$task" projekt="$projekt" dostarczono="$dostarczono" \
      stack="$stack" "wektor:=$([ "$vec" != "NULL" ] && echo true || echo false)"
}

# ── REINDEX ──────────────────────────────────────────────────────────────────
# Baza jest indeksem, nie źródłem prawdy. Ta komenda to dowód: kasujemy
# i odbudowujemy z repo. Rozwiązuje też migrację wymiaru wektora i skutki
# ewentualnej zmiany formatu składowania.
cmd_reindex() {
  local projekt="$PROJEKT_DEFAULT"
  while [ $# -gt 0 ]; do
    case "$1" in --projekt) projekt="$2"; shift 2 ;; *) warn "nieznana opcja: $1"; exit 64 ;; esac
  done
  has_db || { warn "memory.sh reindex: brak bazy"; exit 66; }

  local n=0 pominieto=0 f task
  for f in "$ROOT"/DELIVERY_*.md "$ROOT"/docs/DELIVERY_*.md; do
    [ -e "$f" ] || continue
    task="$(basename "$f" .md)"; task="${task#DELIVERY_}"
    # szablon odsiewany po nazwie ORAZ po symbolach {{...}} w cmd_commit —
    # dwie niezależne bariery, bo szablon w korpusie jest cichym defektem:
    # wygląda jak precedens i może zostać zwrócony przez recall
    if [ "$task" = "TEMPLATE" ]; then
      echo "  · $task — pominięty (szablon)"
      continue
    fi
    if cmd_commit "$task" --projekt "$projekt" >/dev/null 2>&1; then
      echo "  · $task"
      n=$((n+1))
    else
      warn "  · $task — POMINIĘTY (commit zwrócił błąd; uruchom: memory.sh commit $task)"
      pominieto=$((pominieto+1))
    fi
  done
  echo "✓ pamięć: przeindeksowano $n zadań z repo (projekt: $projekt)"
  [ "$pominieto" -gt 0 ] && warn "⚠ pominięto $pominieto — korpus NIEKOMPLETNY. Diagnoza: memory.sh doctor --korpus"
  return 0
}

# ── STATS ────────────────────────────────────────────────────────────────────
cmd_stats() {
  has_db || { echo "pamięć: BAZA NIEDOSTĘPNA — tryb awaryjny (grep po docs/)"; exit 69; }
  local tryb="zdegradowany (FTS)"; has_embed && tryb="pełny (wektor + FTS)"
  echo "PAMIĘĆ ZADAŃ · tryb: $tryb"
  "${PSQL[@]}" -c "
    SELECT '  zadań w pamięci:      ' || count(*) FROM zadania
    UNION ALL SELECT '  z wektorem:           ' || count(*) FROM zadania WHERE embedding IS NOT NULL
    UNION ALL SELECT '  bez wektora (FTS):    ' || count(*) FROM zadania WHERE embedding IS NULL
    UNION ALL SELECT '  antywzorce:           ' || count(*) FROM zadania WHERE antywzorzec
    UNION ALL SELECT '  projektów:            ' || count(DISTINCT projekt) FROM zadania
    UNION ALL SELECT '  stacków:              ' || count(DISTINCT stack) FROM zadania
    UNION ALL SELECT '  wywołań recall:       ' || count(*) FROM recall_log
    UNION ALL SELECT '  rozmiar bazy:         ' || pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null
  echo ""
  echo "  Najczęstsze precedensy (ile razy zwrócone przez recall):"
  "${PSQL[@]}" -F'|' -c "
    SELECT '    ' || u || ' × ' || count(*) FROM recall_log, unnest(zwrocone_ids) u
    WHERE u <> '' GROUP BY u ORDER BY count(*) DESC LIMIT 5;" 2>/dev/null || true
}

# ── DOCTOR ───────────────────────────────────────────────────────────────────
# Diagnostyka warstwy. Mechanizm kontrolny musi wykrywać własną niesprawność
# (lekcja Δ7) — dlatego `doctor` mówi wprost, czego brakuje i jak to naprawić.
cmd_doctor() {
  # `doctor` bada WARSTWĘ (klient, połączenie, CVE, embedder),
  # `doctor --korpus` bada TREŚĆ (baza kontra repo kontra telemetria).
  if [ "${1:-}" = "--korpus" ]; then shift; cmd_korpus "$@"; return $?; fi
  local err=0
  echo "DIAGNOSTYKA PAMIĘCI ZADAŃ"
  if command -v psql >/dev/null 2>&1; then echo "  ✓ klient psql: $(psql --version | head -1)"
  else echo "  ✗ brak klienta psql — zainstaluj postgresql-client"; err=1; fi

  if has_db; then
    echo "  ✓ połączenie: $DB_HOST:$DB_PORT/$DB_NAME"
    local v; v="$("${PSQL[@]}" -c "SELECT extversion FROM pg_extension WHERE extname='vector'" 2>/dev/null || true)"
    if [ -z "$v" ]; then
      echo "  ✗ rozszerzenie vector nieobecne — uruchom: psql < db/001_schema.sql"; err=1
    else
      # CVE-2026-3172: 0.6.0–0.8.1 — wyciek danych z INNYCH relacji, CVSS 8.1
      if printf '%s\n0.8.2\n' "$v" | sort -V | head -1 | grep -qx "$v" && [ "$v" != "0.8.2" ]; then
        echo "  ✗ pgvector $v — PODATNY na CVE-2026-3172 (wyciek międzyrelacyjny). Wymagane ≥ 0.8.2."
        echo "      napraw: ALTER EXTENSION vector UPDATE;  (wydania pomocnicze PG nie aktualizują rozszerzenia)"
        err=1
      else
        echo "  ✓ pgvector $v — próg CVE-2026-3172 spełniony"
      fi
    fi
    local t; t="$("${PSQL[@]}" -c "SELECT to_regclass('zadania') IS NOT NULL" 2>/dev/null || echo f)"
    [ "$t" = "t" ] && echo "  ✓ schemat: tabela zadania obecna" || { echo "  ✗ brak tabeli zadania — wgraj db/001_schema.sql"; err=1; }
  else
    echo "  ✗ brak połączenia z bazą ($DB_HOST:$DB_PORT) — recall zejdzie do trybu awaryjnego"
    echo "      uruchom: docker compose up -d postgres"; err=1
  fi

  echo "  · profil embeddera: $EMBED_PROFIL ($EMBED_BACKEND · $EMBED_MODEL @ $EMBED_URL)"
  if has_embed; then
    case "$EMBED_BACKEND" in
      tei)
        local mid; mid="$(curl -sf --max-time 3 "$EMBED_URL/info" 2>/dev/null \
                          | python3 -c 'import json,sys; print(json.load(sys.stdin).get("model_id",""))' 2>/dev/null || true)"
        if [ "$mid" = "$EMBED_MODEL" ]; then
          echo "  ✓ embedder: $EMBED_MODEL (TEI) @ $EMBED_URL"
        else
          echo "  ✗ embedder serwuje '$mid', a config deklaruje '$EMBED_MODEL' — wektory byłyby z INNEGO modelu"
          echo "      napraw: $EMBED_START   albo popraw profil '$EMBED_PROFIL' w $CONFIG"
          err=1
        fi ;;
      *)
        if curl -sf --max-time 3 "$EMBED_URL/api/tags" 2>/dev/null | grep -q "$EMBED_MODEL"; then
          echo "  ✓ embedder: $EMBED_MODEL (ollama) @ $EMBED_URL"
        else
          echo "  ⚠ embedder działa, ale brak modelu $EMBED_MODEL — recall zejdzie do FTS"
          echo "      napraw: $EMBED_START"
        fi ;;
    esac

    # ── Zgodność wymiarów: config vs embedder vs kolumna w bazie ─────────────
    # Rozjazd wymiaru jest awarią cichą tylko do pierwszego zapisu — pgvector
    # odrzuci INSERT, ale komunikat padnie w środku `commit`, czyli w fazie 8,
    # po dostarczeniu. Lepiej, żeby powiedział to `doctor` przed pracą.
    local wf wb
    wf="$(embed_wymiar_faktyczny || true)"
    if [ -n "$wf" ]; then
      if [ "$wf" = "$EMBED_DIM" ]; then
        echo "  ✓ wymiar wektora: $wf (zgodny z deklaracją profilu)"
      else
        echo "  ✗ wymiar wektora: embedder zwraca $wf, profil '$EMBED_PROFIL' deklaruje $EMBED_DIM"
        echo "      napraw pole \`wymiar\` w $CONFIG — deklaracja jest nieprawdziwa"
        err=1
      fi
      if has_db; then
        wb="$("${PSQL[@]}" -c "SELECT atttypmod FROM pg_attribute
              WHERE attrelid='zadania'::regclass AND attname='embedding'" 2>/dev/null || true)"
        if [ -n "$wb" ] && [ "$wb" != "$wf" ]; then
          echo "  ✗ kolumna zadania.embedding to vector($wb), a embedder zwraca $wf — ZAPIS BĘDZIE ODRZUCANY"
          echo "      migracja: psql … -f db/migrations/002_migrate_dim.sql -v dim=$wf   potem: memory.sh reindex"
          err=1
        elif [ -n "$wb" ]; then
          echo "  ✓ kolumna zadania.embedding: vector($wb) — zgodna z embedderem"
        fi
      fi
    fi
  else
    echo "  ⚠ embedder niedostępny — recall zejdzie do FTS (kod 69)"
    echo "      uruchom: $EMBED_START"
  fi

  echo ""
  [ "$err" -eq 0 ] && echo "Wynik: pamięć sprawna." || echo "Wynik: pamięć działa w trybie ograniczonym (protokół NIE jest zablokowany)."
  return 0
}

# ── DOCTOR --KORPUS ──────────────────────────────────────────────────────────
# Kontrola spójności KORPUSU, nie warstwy: baza kontra repo kontra telemetria.
#
# Powód istnienia. Zasada nadrzędna mówi, że żadna bramka nie odpytuje pamięci
# — i słusznie, bo precedens jest wejściem do osądu, nie predykatem prawdy.
# Cena tej decyzji jest jednak taka, że skrzywiony korpus nie ma jak się
# ujawnić: recall zawsze coś zwróci i zawsze będzie wyglądał wiarygodnie.
# Cztery defekty wykryte przy pierwszym zasileniu (cudze detektory doklejone
# przez dopasowanie podciągiem, data nadpisana przez now(), szablon jako
# precedens, pusty stack) były dokładnie tej natury: każdy cichy, żaden
# możliwy do wychwycenia przez bramkę.
#
# Ta komenda NIE jest bramką i nie ma prawa zatrzymać protokołu — kod wyjścia
# jest informacyjny. Ma robić jedno: mówić głośno to, co inaczej milczy.
cmd_korpus() {
  local projekt="$PROJEKT_DEFAULT"
  while [ $# -gt 0 ]; do
    case "$1" in --projekt) projekt="$2"; shift 2 ;; *) warn "nieznana opcja: $1"; exit 64 ;; esac
  done
  has_db || { warn "memory.sh doctor --korpus: brak bazy"; exit 66; }

  local baza
  baza="$("${PSQL[@]}" -F$'\t' -c "
    SELECT task_id, to_char(dostarczono,'YYYY-MM-DD'), stack,
           array_to_string(detektory_dodane,','), coalesce(ref_delivery,''),
           (embedding IS NOT NULL)::text, tytul
    FROM zadania WHERE projekt='$(sql_lit "$projekt")' ORDER BY task_id;" 2>/dev/null || true)"

  local telem=""
  local f task
  for f in "$ROOT"/DELIVERY_*.md "$ROOT"/docs/DELIVERY_*.md; do
    [ -e "$f" ] || continue
    task="$(basename "$f" .md)"; task="${task#DELIVERY_}"
    telem="${telem}${task}"$'\t'"$(metryki_zadania "$task")"$'\t'"${f#$ROOT/}"$'\n'
  done

  ROOT="$ROOT" python3 - "$projekt" "$baza" "$telem" <<'PY'
import os,re,sys
root, projekt, baza_raw, telem_raw = os.environ["ROOT"], sys.argv[1], sys.argv[2], sys.argv[3]

baza = {}
for l in baza_raw.splitlines():
    if not l.strip(): continue
    p = (l.split("\t") + [""]*7)[:7]
    baza[p[0]] = {"data":p[1], "stack":p[2], "det":p[3], "ref":p[4],
                  "wektor":p[5]=="true", "tytul":p[6]}

repo = {}
for l in telem_raw.splitlines():
    if not l.strip(): continue
    task, metr, ref = l.split("\t")[0], l.split("\t")[1], l.split("\t")[2]
    fail, it, esk, det = (metr.split("|") + [""]*4)[:4]
    repo[task] = {"det":det, "ref":ref, "fail":fail, "esk":esk}

def naglowek_daty(ref):
    try:
        with open(os.path.join(root, ref), encoding="utf-8") as fh:
            m = re.search(r'\((\d{4}-\d{2}-\d{2})\)', fh.readline())
            return m.group(1) if m else None
    except OSError:
        return None

def szablon(ref):
    try:
        with open(os.path.join(root, ref), encoding="utf-8") as fh:
            return bool(re.search(r'\{\{[A-Za-z_]*\}\}', fh.read()))
    except OSError:
        return False

problemy = []
P = problemy.append

for t in sorted(set(baza) - set(repo)):
    P(("SIEROTA", t, f"wiersz w bazie bez pliku DELIVERY w repo (ref: {baza[t]['ref'] or '—'})",
       "usuń wiersz albo przywróć manifest"))

for t in sorted(set(repo) - set(baza)):
    if t == "TEMPLATE" or szablon(repo[t]["ref"]): continue
    P(("LUKA", t, f"DELIVERY w repo ({repo[t]['ref']}) bez wiersza w bazie",
       f"memory.sh commit {t}"))

for t in sorted(set(baza) & set(repo)):
    b, r = baza[t], repo[t]
    if t == "TEMPLATE" or szablon(r["ref"]) or "{{" in b["tytul"]:
        P(("SZABLON", t, "szablon zaindeksowany jako precedens — recall może go zwrócić",
           f"DELETE FROM zadania WHERE task_id='{t}'"))
    d = naglowek_daty(r["ref"])
    if d and d != b["data"]:
        P(("DATA", t, f"data w bazie {b['data']} != nagłówek manifestu {d} — waga wieku liczona ze złej daty",
           f"memory.sh commit {t}"))
    if b["det"] != r["det"]:
        P(("DETEKTORY", t, f"baza [{b['det'] or '—'}] != przeliczone z telemetrii [{r['det'] or '—'}]",
           f"memory.sh commit {t}"))
    if b["stack"] in ("", "nieokreslony"):
        P(("STACK", t, "stack nieokreślony — filtr --stack nie odsiewa tego wiersza",
           "ustaw pole `stack` w .hait/hait.config.json, potem memory.sh reindex"))
    if not b["wektor"]:
        P(("WEKTOR", t, "brak wektora — wpis wyszukiwalny tylko pełnotekstowo",
           "uruchom embedder, potem memory.sh reindex"))

print(f"KONTROLA KORPUSU · projekt: {projekt} · wierszy w bazie: {len(baza)} · manifestów w repo: {len(repo)}")
print("")
if not problemy:
    print("  ✓ korpus spójny — baza zgodna z repo i telemetrią")
    sys.exit(0)

szer = max(len(p[0]) for p in problemy)
for kat, t, opis, napraw in problemy:
    print(f"  ✗ {kat:<{szer}}  {t}")
    print(f"    {'':<{szer}}  {opis}")
    print(f"    {'':<{szer}}  → {napraw}")
print("")
print(f"  {len(problemy)} niezgodności. To NIE jest bramka — protokół nie jest zablokowany,")
print("  ale precedens zwracany przez recall jest w tym zakresie niewiarygodny.")
sys.exit(1)
PY
}

MODE="${1:-}"; [ -n "$MODE" ] && shift || { warn "użycie: memory.sh <recall|commit|reindex|stats|doctor> …"; exit 64; }
case "$MODE" in
  recall)  cmd_recall  "$@" ;;
  commit)  cmd_commit  "$@" ;;
  reindex) cmd_reindex "$@" ;;
  stats)   cmd_stats   "$@" ;;
  doctor)  cmd_doctor  "$@" ;;
  -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) warn "memory.sh: nieznany tryb '$MODE' (recall|commit|reindex|stats|doctor)"; exit 64 ;;
esac
