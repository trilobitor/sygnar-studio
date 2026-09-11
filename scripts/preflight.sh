#!/usr/bin/env bash
# AiOS Fazowy v1.0-S — PRE-FLIGHT (krok 0)
# Parsuje docs/STACK_PITFALLS.md i WYKONUJE pole `detect:` każdej pułapki.
# tryb empty  : jakikolwiek output detektora  => FAIL
# tryb obecny : brak outputu detektora        => FAIL
# tryb raport : output                        => WARN (nie blokuje)
# Wyjście: 0 gdy zero FAIL, 1 gdy FAIL. Zdarzenie trafia do telemetry/events.jsonl.
set -uo pipefail   # celowo BEZ -e: grep zwraca 1 przy braku trafień i to jest stan poprawny

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${AIOS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REGISTRY="$ROOT/docs/STACK_PITFALLS.md"
TASK="-"
FILTER_KAT=""
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --registry)  REGISTRY="$2"; shift 2 ;;
    --task)      TASK="$2";     shift 2 ;;
    --kategoria) FILTER_KAT="$2"; shift 2 ;;
    --quiet)     QUIET=1;       shift ;;
    -h|--help)
      echo "użycie: preflight.sh [--task ID] [--kategoria A-H] [--registry PLIK] [--quiet]"
      exit 0 ;;
    *) echo "preflight: nieznana opcja: $1" >&2; exit 64 ;;
  esac
done

[ -f "$REGISTRY" ] || { echo "preflight: brak rejestru: $REGISTRY" >&2; exit 66; }
# ścieżka absolutna PRZED cd — inaczej względny --registry wskaże w próżnię po zmianie katalogu
REGISTRY="$(cd "$(dirname "$REGISTRY")" && pwd)/$(basename "$REGISTRY")"
cd "$ROOT"
. "$SCRIPT_DIR/lib/aios-root.sh" 2>/dev/null || { echo "preflight: brak scripts/lib/aios-root.sh — powłoka niekompletna" >&2; exit 78; }
STATE="$(aios_state_root "$ROOT")"

PASS=0; WARN=0; FAIL=0; POMIN=0; WYCOF=0
FAIL_IDS=""; WARN_IDS=""; POMIN_IDS=""; WYCOF_IDS=""

log() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

show_hits() { # wcięte pierwsze 5 linii trafień
  printf '%s\n' "$1" | head -5 | sed 's/^/        /'
  local n; n=$(printf '%s\n' "$1" | wc -l)
  [ "$n" -gt 5 ] && printf '        … (+%d linii)\n' $((n - 5))
}

# ── zakres detektora: czy ma na czym zadziałać ────────────────────────────────
# Detektor skanujący katalog, którego w drzewie nie ma, jest zielony ZAWSZE —
# mierzy własną nieobecność. Rejestr jest przenośny między stackami, więc taki
# stan jest normalny; nie jest normalne raportowanie go jako PASS.
# Heurystyka, świadomie konserwatywna: pominięcie orzekamy TYLKO gdy detektor
# wymienia co najmniej jeden korzeń skanowania i ŻADEN z nich nie istnieje.
# Za korzeń uznajemy token ze znakiem ukośnika (bierzemy pierwszy segment) albo
# gołe słowo z listy nazw katalogów źródłowych. Ograniczenie: detektor
# odwołujący się do ścieżki wyłącznie przez zmienną nie zostanie rozpoznany.
KORZENIE_GOLE=" app components lib src pages test tests scripts modules docs telemetry "

zakres_pusty() {
  local det="$1" tok seg istnieje=0 brakuje=0
  # `set -f`: treść detektora jest GĘSTA OD WZORCÓW, a nieocytowane rozwinięcie
  # w `for` przechodzi podział na słowa ORAZ rozwinięcie ścieżek. Token typu
  # `*.mjs` zamieniłby się w nazwy plików z katalogu bieżącego i heurystyka
  # zakresu zaczęłaby zależeć od tego, co akurat leży w drzewie. Dziś nie
  # manifestuje się przy żadnym z wpisów — sprawdzone, wszystkie wzorce sąsiadują
  # ze średnikiem lub cudzysłowem — więc to profilaktyka, nie naprawa objawu.
  # Ta sama przyczyna, która 13.08.2026 zepsuła warstwę wyłączeń w integrate.sh.
  set -f
  for tok in $det; do
    case "$tok" in
      -*|\'*|\"*|\$*|\`*|*\**) continue ;;
    esac
    case "$tok" in
      */*) seg="${tok%%/*}" ;;
      *)   case "$KORZENIE_GOLE" in *" $tok "*) seg="$tok" ;; *) continue ;; esac ;;
    esac
    case "$seg" in ""|"."|".."|http:|https:) continue ;; esac
    if [ -e "$seg" ]; then istnieje=$((istnieje+1)); else brakuje=$((brakuje+1)); fi
  done
  set +f
  # `set +f` MUSI stać przed poniższym testem: to on jest wartością zwracaną
  # funkcji, a `set +f` na końcu nadpisałby ją zerem i każdy detektor byłby
  # uznany za pominięty.
  [ "$brakuje" -gt 0 ] && [ "$istnieje" -eq 0 ]
}

run_entry() { # $1=id $2=tytuł $3=kategoria $4=tryb $5=detect $6=wycofany
  local id="$1" title="$2" kat="$3" tryb="$4" det="$5" wyc="${6:-}" out verdict
  [ -n "$det" ] || return 0
  [ -n "$FILTER_KAT" ] && [ "$kat" != "$FILTER_KAT" ] && return 0
  # Wycofanie jest DECYZJĄ, więc bije wszystkie pozostałe powody niewykonania —
  # inaczej wpis zdjęty świadomie zlałby się z wpisem bez zakresu i nie dałoby
  # się odróżnić „zrezygnowaliśmy" od „nie ma czego mierzyć" (scripts/retire-pitfall.sh).
  if [ -n "$wyc" ]; then
    WYCOF=$((WYCOF+1)); WYCOF_IDS="${WYCOF_IDS:+$WYCOF_IDS,}$id"
    log "  [WYCOF] $id  $title"
    [ "$QUIET" -eq 1 ] || log "        wycofany: $wyc — nie jest wykonywany; treść wpisu zostaje w rejestrze"
    return 0
  fi
  if zakres_pusty "$det"; then
    POMIN=$((POMIN+1)); POMIN_IDS="${POMIN_IDS:+$POMIN_IDS,}$id"
    log "  [POMIN] $id  $title"
    [ "$QUIET" -eq 1 ] || log "        zakres pusty w tym drzewie — detektor nic nie mierzy, to NIE jest zaliczenie"
    return 0
  fi
  out="$(bash -c "$det" 2>/dev/null || true)"
  case "$tryb" in
    empty)  if [ -n "$out" ]; then verdict=FAIL; else verdict=PASS; fi ;;
    obecny) if [ -z "$out" ]; then verdict=FAIL; else verdict=PASS; fi ;;
    raport) if [ -n "$out" ]; then verdict=WARN; else verdict=PASS; fi ;;
    *)      verdict=WARN; out="(nieznany tryb: '$tryb' — sprawdź wpis w rejestrze)" ;;
  esac
  case "$verdict" in
    PASS) PASS=$((PASS+1)); log "  [PASS] $id  $title" ;;
    WARN) WARN=$((WARN+1)); WARN_IDS="${WARN_IDS:+$WARN_IDS,}$id"
          log "  [WARN] $id  $title"; [ "$QUIET" -eq 1 ] || show_hits "$out" ;;
    FAIL) FAIL=$((FAIL+1)); FAIL_IDS="${FAIL_IDS:+$FAIL_IDS,}$id"
          log "  [FAIL] $id  $title"; [ "$QUIET" -eq 1 ] || show_hits "$out" ;;
  esac
}

# ── parser rejestru (pomija bloki kodu ``` — tam żyją przykłady formatu) ──────
id=""; title=""; kat=""; tryb=""; det=""; wyc=""; in_fence=0
flush() { [ -n "$id" ] && run_entry "$id" "$title" "$kat" "$tryb" "$det" "$wyc"; id=""; title=""; kat=""; tryb=""; det=""; wyc=""; }

log "PRE-FLIGHT · rejestr: $REGISTRY"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '```'*) in_fence=$((1 - in_fence)); continue ;; esac
  [ "$in_fence" -eq 1 ] && continue
  case "$line" in
    '### [P-'*)
      flush
      id="${line#\#\#\# [}"; id="${id%%]*}"
      title="${line#*] }"
      ;;
    '- kategoria: '*) kat="${line#- kategoria: }" ;;
    '- tryb: '*)      tryb="${line#- tryb: }" ;;
    '- detect: '*)    det="${line#- detect: }" ;;
    '- wycofany: '*)  wyc="${line#- wycofany: }" ;;
  esac
done < "$REGISTRY"
flush

TOTAL=$((PASS + WARN + FAIL + POMIN + WYCOF))
WYKONANE=$((PASS + WARN + FAIL))
# Zero wykonanych detektorów = rejestr pusty lub nieczytelny. Cisza NIE jest sukcesem:
# brak kontroli nie może udawać przejścia (ta sama zasada, co SKIPPED w bramce C).
if [ "$TOTAL" -eq 0 ]; then
  echo "preflight: 0 detektorów wykonanych — rejestr pusty lub nieczytelny: $REGISTRY" >&2
  exit 66
fi
log "PRE-FLIGHT: $TOTAL detektorów · wykonanych $WYKONANE · PASS $PASS · WARN $WARN · FAIL $FAIL · POMINIĘTYCH $POMIN · WYCOFANYCH $WYCOF"
[ "$POMIN" -gt 0 ] && log "  POMINIĘTE (zakres pusty w tym drzewie, nic nie mierzą): $POMIN_IDS"
[ "$WYCOF" -gt 0 ] && log "  WYCOFANE (decyzja zapisana w rejestrze, nie są wykonywane): $WYCOF_IDS"
# Rejestr złożony wyłącznie z wpisów pominiętych i wycofanych daje zero FAIL —
# i wygląda dokładnie jak siatka, która wszystko sprawdziła. Cisza nie jest sukcesem.
[ "$WYKONANE" -eq 0 ] && echo "preflight: UWAGA — wykonano 0 detektorów z $TOTAL. Zero FAIL nie znaczy tu nic." >&2

mkdir -p "$STATE/telemetry"
printf '{"ts":"%s","typ":"preflight","task":"%s","pass":%d,"warn":%d,"fail":%d,"fail_ids":"%s","warn_ids":"%s","pominiete":%d,"wycofane":%d,"wykonane":%d}\n' \
  "$(date -Iseconds)" "$TASK" "$PASS" "$WARN" "$FAIL" "$FAIL_IDS" "$WARN_IDS" "$POMIN" "$WYCOF" "$WYKONANE" \
  >> "$STATE/telemetry/events.jsonl"

[ "$FAIL" -eq 0 ]
