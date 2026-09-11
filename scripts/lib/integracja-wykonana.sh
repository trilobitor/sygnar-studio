#!/usr/bin/env bash
# integracja-wykonana.sh -- detektor: zadanie ma docs/contracts/<T>.kontrakt.md
# i manifest dostarczenia, a telemetria nie zna dla niego ani jednego zdarzenia
# fazy 4 ze statusem PASS. Patrz docs/contracts/T-INT-1.kontrakt.md.
#
#   scripts/lib/integracja-wykonana.sh [<korzen>]     # <korzen> domyslnie `.`
#
# - Kod wyjscia ZAWSZE 0. Werdykt niesie stdout, nie kod (kontrakt S2).
# - Czyta WYLACZNIE piec wejsc plikowych z S1.1: scripts/lib/aios-root.sh,
#   kandydatow <korzen>/DELIVERY*.md i <korzen>/docs/DELIVERY*.md,
#   <STAN>/telemetry/events.jsonl oraz docs/contracts/*.kontrakt.md (samo
#   istnienie -- ten plik nie jest otwierany). Nie wola `git` bezposrednio --
#   wola go wylacznie aios_state_root (T-SHELL-1). Nie pisze zadnego pliku,
#   nie robi `cd`.
# - STDOUT: jedna linia na komunikat, wylacznie ASCII. STDERR: zero bajtow.
# - Bez mapfile/readarray (bash 3.2), bez sed -i, bez set -e,
#   bez set -o nullglob, bez cd, bez odwolywania sie do zmiennej korzenia
#   stanu inaczej niz przez aios_state_root, bez tablic asocjacyjnych, zero
#   podprocesow w petli po liniach telemetrii (kontrakt S2).
# - Predykaty wejscia is_readable i is_entry_present sa KOPIA BAJTOWA z
#   scripts/lib/klasyfikacja-arbitra.sh (kontrakt S1.1, ADR D-4) -- kopia,
#   nie wspoldzielenie; proba P18 pilnuje rozjazdu literalu, jednostronnie.
# - Piate wejscie (aios-root.sh) jest wczytywane PRZEZ POWLOKE i dlatego
#   podlega OBU predykatom PRZED wczytaniem: jako potok nazwany blokuje
#   wczytanie na otwarciu pliku i wiesza caly przebieg bez bajtu wyjscia
#   (kontrakt S1.1 poz. dot. piatego wejscia, S2 krok 2, ADR D-8).

ROOT="${1:-.}"

[ -d "$ROOT/docs/contracts" ] || exit 0

TAB=$'\t'

# -- S1.1: JEDNA definicja "czytelne" -- kopia bajtowa z klasyfikacja-arbitra.sh
is_readable() {
  [ -f "$1" ] && [ -r "$1" ]
}

# -- S1.1: JEDNA definicja "istnieje" -- kopia bajtowa z klasyfikacja-arbitra.sh
is_entry_present() {
  [ -e "$1" ] || [ -L "$1" ]
}

# -- S2: listowanie plikow; pomijana WYLACZNIE literalna niedopasowana pozycja.
sorted_glob() {
  local d="$1" pat="$2" f lit="$1/$2"
  for f in "$d"/$pat; do
    if [ "$f" = "$lit" ]; then
      continue
    fi
    printf '%s\n' "$f"
  done | LC_ALL=C sort
}

# -- S1.3: E(T) liczone PO przebiegu, na lancuchu wystapien, bez podprocesu --
count_occurrences() {
  local chain="$1" tok="$2" cnt=0 word
  while [ -n "$chain" ]; do
    word="${chain%%" "*}"
    chain="${chain#*" "}"
    [ "$word" = "$tok" ] && cnt=$((cnt+1))
  done
  E_RESULT="$cnt"
}

# -- S3: komunikaty, dosłownie -----------------------------------------------
emit_K1() { printf '%s\n' "integracja-wykonana [$1]: zadanie ma docs/contracts/$1.kontrakt.md i manifest dostarczenia; zdarzen fazy 4 w telemetrii: $2, w tym ze statusem PASS: 0 - faza 4 nie zostala zaliczona narzedziem"; }
emit_K2() { printf '%s\n' "integracja-wykonana: $1 nie istnieje - wykonania fazy 4 nie da sie stwierdzic dla zadnego zadania - pomiar NIEWYKONANY"; }
emit_K3() { printf '%s\n' "integracja-wykonana: $1 istnieje, ale nie da sie jej odczytac - pomiar NIEWYKONANY"; }
emit_K4() { printf '%s\n' "integracja-wykonana: $1 nie zawiera ani jednego zdarzenia fazy 4 z czytelnym identyfikatorem zadania - to nie jest dowod, ze fazy 4 nie uruchamiano - pomiar NIEWYKONANY"; }
emit_K5() { printf '%s\n' "integracja-wykonana: scripts/lib/aios-root.sh - $1 - korzenia stanu nie da sie wyznaczyc, a telemetria nie lezy w drzewie roboczym - pomiar NIEWYKONANY"; }
emit_K6() { printf '%s\n' "integracja-wykonana: $1 istnieje, ale nie da sie go odczytac - naglowek tego manifestu nie wchodzi do pomiaru ukonczenia - pomiar NIEWYKONANY"; }
emit_K7() { printf '%s\n' "integracja-wykonana: linii ze znacznikiem fazy 4 bez dajacego sie wyodrebnic identyfikatora zadania: $1 - tyle zdarzen nie weszlo do pomiaru"; }

# ================== S2 krok 2: piate wejscie, trzy warstwy w kolejnosci ======
AIOS_ROOT_SH="$ROOT/scripts/lib/aios-root.sh"

if ! is_entry_present "$AIOS_ROOT_SH"; then
  emit_K5 "brak wpisu"
  exit 0
fi
if ! is_readable "$AIOS_ROOT_SH"; then
  emit_K5 "wpis istnieje, ale plik nie jest czytelny"
  exit 0
fi
. "$AIOS_ROOT_SH" 2>/dev/null
if ! declare -F aios_state_root >/dev/null 2>&1; then
  emit_K5 "plik wczytany, ale nie definiuje funkcji aios_state_root"
  exit 0
fi
STATE="$(aios_state_root "$ROOT")"

# ================== S2 krok 3: telemetria, oba testy PRZED otwarciem ========
TELEMETRY="$STATE/telemetry/events.jsonl"

if ! is_entry_present "$TELEMETRY"; then
  emit_K2 "$TELEMETRY"
  exit 0
fi
if ! is_readable "$TELEMETRY"; then
  emit_K3 "$TELEMETRY"
  exit 0
fi

# ================== S2 krok 4: Regula P -- JEDEN przebieg, zero podprocesow =
N=0
U=0
OCCUR=""
PASSED=" "

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *'"faza":4'*) ;;
    *) continue ;;
  esac
  case "$line" in
    *'"task":"'*) ;;
    *) U=$((U+1)); continue ;;
  esac
  rest="${line#*'"task":"'}"
  case "$rest" in
    *'"'*) id="${rest%%'"'*}" ;;
    *) id="" ;;
  esac
  if [ -z "$id" ]; then
    U=$((U+1))
    continue
  fi
  N=$((N+1))
  OCCUR="${OCCUR}${id} "
  case "$line" in
    *'"status":"PASS"'*)
      case "$PASSED" in
        *" $id "*) ;;
        *) PASSED="${PASSED}${id} " ;;
      esac
      ;;
  esac
done < "$TELEMETRY"

[ "$U" -gt 0 ] && emit_K7 "$U"

if [ "$N" -eq 0 ]; then
  emit_K4 "$TELEMETRY"
  exit 0
fi

# ================== S2 krok 5: Regula D -- spis kandydatow, obie przeslanki =
NAMES=" "
HEADERS=""

while IFS= read -r C; do
  [ -n "$C" ] || continue
  base="${C##*/}"
  case "$base" in
    DELIVERY_*.md)
      Tname="${base#DELIVERY_}"
      Tname="${Tname%.md}"
      if [ -n "$Tname" ]; then
        case "$NAMES" in
          *" $Tname "*) ;;
          *) NAMES="${NAMES}${Tname} " ;;
        esac
      fi
      ;;
  esac
  if is_readable "$C"; then
    header=""
    IFS= read -r header < "$C"
    normalized="${header//"$TAB"/ }"
    HEADERS="${HEADERS} ${normalized} "
  else
    emit_K6 "$C"
  fi
done < <(sorted_glob "$ROOT" 'DELIVERY*.md'; sorted_glob "$ROOT/docs" 'DELIVERY*.md')

# ================== S2 krok 6: tabela S1.4 wiersze 8-10, na zadanie =========
while IFS= read -r KF; do
  [ -n "$KF" ] || continue
  base="${KF##*/}"
  T="${base%.kontrakt.md}"

  ukonczone=0
  case "$NAMES" in
    *" $T "*) ukonczone=1 ;;
  esac
  if [ "$ukonczone" -eq 0 ]; then
    case "$HEADERS" in
      *" $T "*) ukonczone=1 ;;
    esac
  fi
  [ "$ukonczone" -eq 1 ] || continue

  case "$PASSED" in
    *" $T "*) continue ;;
  esac

  count_occurrences "$OCCUR" "$T"
  emit_K1 "$T" "$E_RESULT"
done < <(sorted_glob "$ROOT/docs/contracts" '*.kontrakt.md')

exit 0
