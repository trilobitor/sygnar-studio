#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# integrate.sh — FAZA 4: integracja deterministyczna
#
#   integrate.sh <TASK> --branches "feat/a,feat/b" [--contract <plik>] [--into <gałąź>]
#
# ZASADA NADRZĘDNA: LLM NIE SCALA KODU.
# Scalanie jest operacją, w której halucynacja jest szczególnie kosztowna, bo
# jej wynik wygląda poprawnie. Ten skrypt wykonuje scalenie, budowanie i
# sprawdzenie zgodności z kontraktem. Arbiter wchodzi WYŁĄCZNIE tam, gdzie
# skrypt zwróci konflikt, którego nie umie rozstrzygnąć (exit 70).
#
# KODY WYJŚCIA
#   0   PASS — scalone, build przechodzi, symbole kontraktu obecne
#   1   FAIL — build nie przechodzi albo brak symboli z kontraktu
#   64  błąd użycia
#   70  KONFLIKT SCALANIA — wymaga rozstrzygnięcia; drzewo pozostaje w stanie
#       konfliktu, żeby dało się je obejrzeć. NIE rozwiązujemy automatycznie.
#   75  blokada RCA (spójne z gate.sh — druga próba bez `detect:` nie rusza)
#
# DROGA ODWROTU: skrypt tworzy gałąź integracyjną i NIE dotyka gałęzi bazowej.
# Wycofanie: `git checkout <bazowa> && git branch -D <gałąź-integracyjna>`.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${HAIT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT" || exit 64
. "$SCRIPT_DIR/lib/aios-root.sh" 2>/dev/null || { echo "integrate.sh: brak scripts/lib/aios-root.sh — powłoka niekompletna" >&2; exit 78; }
STATE="$(aios_state_root "$ROOT")"

BUILD_CMD="${BUILD_CMD:-npm run build}"
TELEMETRY="${TELEMETRY:-$STATE/telemetry/events.jsonl}"

# ── warstwa wyłączeń skanu symboli (wydzielona, żeby dała się ZMIERZYĆ) ──────
# Była wpleciona w blok kontroli kontraktu, więc jedyne, co detektor umiał o niej
# powiedzieć, to „nazwa zmiennej stoi w pliku". 13.08.2026 okazało się, że to za
# mało: pętla budująca listę argumentów rozwijała wzorce (patrz komentarz niżej),
# a oba detektory pilnujące tej warstwy — [P-H06] i [P-H10] — były zielone.
# Wydzielenie do funkcji + tryb `--wypisz-wylaczenia` dają szew, na którym można
# sprawdzić WYNIK, a nie pisownię.
zbuduj_wylaczenia() {
  SCAN_EXCLUDE_DIRS="${SCAN_EXCLUDE_DIRS:-.git node_modules target dist build vendor .venv docs telemetry .aios .claude .hait}"
  SCAN_EXCLUDE_GLOBS="${SCAN_EXCLUDE_GLOBS:-*.md *.mdx *.txt *.rst}"
  GREP_EXCL=""
  # `set -f` JEST WARUNKIEM POPRAWNOŚCI, nie ostrożnością. Nieocytowane $LISTA
  # w `for` przechodzi podział na słowa ORAZ rozwinięcie ścieżek, więc `*.md`
  # zamieniało się w nazwy plików .md z katalogu bieżącego: zamiast
  # `--exclude=*.md` powstawało `--exclude=DELIVERY.md --exclude=README.md`.
  # Wyłączenie po wzorcu znikało, a wraz z nim ochrona przed maskowaniem
  # symboli przez prozę — po cichu i tym mocniej, im więcej plików w korzeniu.
  # Podział na słowa jest tu POTRZEBNY, rozwijanie ścieżek NIE — `set -f`
  # wyłącza dokładnie to drugie.
  set -f
  for _d in $SCAN_EXCLUDE_DIRS;  do GREP_EXCL="$GREP_EXCL --exclude-dir=$_d"; done
  for _g in $SCAN_EXCLUDE_GLOBS; do GREP_EXCL="$GREP_EXCL --exclude=$_g"; done
  set +f
}

# Tryb diagnostyczny: wypisz zbudowaną listę wyłączeń i wyjdź. Stoi PRZED
# wymaganiem argumentu <TASK>, bo nie dotyczy żadnego zadania.
if [ "${1:-}" = "--wypisz-wylaczenia" ]; then zbuduj_wylaczenia; printf '%s\n' "$GREP_EXCL"; exit 0; fi

TASK="${1:-}"; [ -n "$TASK" ] && shift || { echo "użycie: integrate.sh <TASK> --branches \"a,b\"" >&2; exit 64; }
BRANCHES=""; CONTRACT=""; INTO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branches) BRANCHES="$2"; shift 2 ;;
    --contract) CONTRACT="$2"; shift 2 ;;
    --into)     INTO="$2";     shift 2 ;;
    *) echo "integrate.sh: nieznana opcja: $1" >&2; exit 64 ;;
  esac
done
[ -n "$BRANCHES" ] || { echo "integrate.sh: podaj --branches" >&2; exit 64; }

CONTRACT="${CONTRACT:-docs/contracts/$TASK.kontrakt.md}"
BASE="${INTO:-$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo main)}"
INTEG="integ/$TASK"

log() { printf '  %s\n' "$*"; }
event() { # <status> <powod>
  mkdir -p "$(dirname "$TELEMETRY")"
  printf '{"ts":"%s","faza":4,"task":"%s","status":"%s","powod":"%s"}\n' \
    "$(date -Iseconds)" "$TASK" "$1" "$2" >> "$TELEMETRY"
}

echo
log "FAZA 4 — integracja deterministyczna · zadanie $TASK"
log "bazowa: $BASE · integracyjna: $INTEG"
echo

# ── 1. Gałąź integracyjna ─────────────────────────────────────────────────
# Zawsze świeża: integracja powtórzona na brudnej gałęzi daje wynik, którego
# nie da się przypisać do żadnego przebiegu.
git rev-parse --verify --quiet "$INTEG" >/dev/null && git branch -D "$INTEG" >/dev/null 2>&1
git checkout -q -b "$INTEG" "$BASE" || { echo "integrate.sh: nie mogę utworzyć $INTEG" >&2; exit 1; }

# ── 2. Scalanie ───────────────────────────────────────────────────────────
IFS=',' read -ra ARR <<< "$BRANCHES"
for b in "${ARR[@]}"; do
  b="$(echo "$b" | xargs)"
  [ -n "$b" ] || continue
  if ! git rev-parse --verify --quiet "$b" >/dev/null; then
    log "BRAK gałęzi: $b"; event FAIL "brak-galezi:$b"; exit 1
  fi
  if git merge --no-ff --no-edit "$b" >/dev/null 2>&1; then
    log "scalono     $b"
  else
    log "KONFLIKT    $b"
    log "pliki w konflikcie:"
    git diff --name-only --diff-filter=U | sed 's/^/    /'
    echo
    log "Drzewo zostaje w stanie konfliktu — obejrzyj je, zanim cokolwiek zrobisz."
    log "Rozstrzyga Arbiter, nie ten skrypt. Wycofanie:"
    log "  git merge --abort && git checkout $BASE && git branch -D $INTEG"
    event KONFLIKT "$b"
    exit 70
  fi
done

# ── 3. Build całości ──────────────────────────────────────────────────────
# Osobno od bramki A: tam każdy implementator budował SWOJĄ część. Tu po raz
# pierwszy budujemy sumę — i to jest jedyne miejsce, gdzie wychodzą kolizje
# między nimi.
echo
log "build całości: $BUILD_CMD"
if ! out="$(eval "$BUILD_CMD" 2>&1)"; then
  echo "$out" | tail -25 | sed 's/^/    /'
  event FAIL "build"
  echo; log "FAIL — build całości nie przechodzi"
  exit 1
fi
log "build         PASS"

# ── 4. Zgodność z kontraktem ──────────────────────────────────────────────
# Sprawdzamy, czy symbole zadeklarowane w kontrakcie faktycznie istnieją
# w kodzie. To jest tania proteza na najczęstszy tryb porażki: implementator
# nazwał rzecz inaczej, build przechodzi, a integracja rozjeżdża się dopiero
# w runtime. Symbole to linie kontraktu w backtickach.
if [ -f "$CONTRACT" ]; then
  # Uwaga na przenośność: `mapfile` to bash 4+, a macOS dostarcza bash 3.2.
  # Tam wywołanie kończyło się "command not found", a następne rozwinięcie
  # "${SYMS[@]}" pod `set -u` przerywało skrypt kodem 127 — PO scaleniu i buildzie,
  # przed zapisem zdarzenia. Kontrola symboli, czyli jedyna ochrona przed rozjazdem
  # nazw, milczała w sposób nieodróżnialny od awarii skryptu. Pętla `while read`
  # jest równoważna i działa od bash 3.2 wzwyż.
  SYMS=""
  while IFS= read -r _sym; do
    SYMS="${SYMS}${_sym}
"
  done < <(grep -oE '`[A-Za-z_][A-Za-z0-9_./-]{2,}`' "$CONTRACT" \
           | tr -d '`' | sort -u)
  # ZAKRES SKANOWANIA: symbol ma istnieć w KODZIE, nie w prozie.
  # Wcześniej grep przeszukiwał całe drzewo, więc dowolny dokument wymieniający
  # nazwę — ADR, RCA, PHASE_STATE, werdykt recenzji, ten komentarz — zaspokajał
  # kontrolę i po cichu ją wyłączał. Efekt był odwrotny do zamierzonego: im
  # staranniej opisano zadanie, tym mniej symboli faktycznie sprawdzano.
  # W przebiegu T-ABC ADR z fazy 1 maskował w ten sposób 22 z 50 symboli.
  # Nadpisywalne przez env, bo układ katalogów jest cechą projektu, nie protokołu.
  zbuduj_wylaczenia
  log "zakres symboli: całe drzewo minus [$SCAN_EXCLUDE_DIRS] i [$SCAN_EXCLUDE_GLOBS]"

  missing=0
  syms_count=0
  skip_count=0
  # `set -f` obowiązuje TAKŻE tutaj: $GREP_EXCL jest rozwijany po raz drugi
  # w wywołaniu grepa, więc bez tego `--exclude=*.md` rozsypałoby się na nazwy
  # plików dokładnie tak samo, jak przy budowaniu listy. Zdjęte po pętli.
  set -f
  for s in $SYMS; do
    # ścieżki i pliki pomijamy — nie są symbolami. Liczymy je osobno, żeby
    # komunikat PASS mówił, ile REALNIE sprawdzono, a nie ile znaleziono tokenów.
    case "$s" in */*|*.*) skip_count=$((skip_count + 1)); continue ;; esac
    syms_count=$((syms_count + 1))
    # $GREP_EXCL celowo nieocytowane — to lista argumentów, nie jeden argument.
    if ! grep -rqF $GREP_EXCL -- "$s" . 2>/dev/null; then
      log "BRAK symbolu: $s"
      missing=$((missing + 1))
    fi
  done
  set +f
  if [ "$missing" -gt 0 ]; then
    event FAIL "kontrakt:$missing"
    echo; log "FAIL — $missing symboli z kontraktu nie istnieje w kodzie"
    log "To nie jest błąd budowania. To rozjazd nazw między kontraktem a implementacją."
    exit 1
  fi
  log "kontrakt      PASS ($syms_count symboli sprawdzonych, $skip_count ścieżek pominiętych)"
else
  log "kontrakt      POMINIĘTO — brak $CONTRACT"
  log "              Faza 1 nie wyprodukowała kontraktu; to jest usterka fazy 1."
fi

# ── 5. Wynik ──────────────────────────────────────────────────────────────
event PASS ""
echo
log "PASS — gałąź $INTEG gotowa do fazy 5"
log "wycofanie: git checkout $BASE && git branch -D $INTEG"
echo
exit 0
