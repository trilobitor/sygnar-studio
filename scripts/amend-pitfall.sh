#!/usr/bin/env bash
# AiOS Fazowy v1.0-S — AMEND-PITFALL (trzecia droga do rejestru)
#
#   amend-pitfall.sh <plik-RCA> --id P-H05 --tryb raport [--registry PLIK]
#
# DLACZEGO TO ISTNIEJE
# Protokół miał dotąd dwie drogi do rejestru pułapek: `add-pitfall.sh` (dopisanie nowego
# wpisu z RCA) i nic więcej — bezpośrednia edycja jest zablokowana uprawnieniami
# (`Edit`/`Write` na docs/STACK_PITFALLS.md), żeby nikt nie psuł rejestru ręcznie.
# Brakowało trzeciej: **korekty istniejącego wpisu**. Ujawniło to T-ABC-2: detektor P-H05
# dostał tryb `empty`, choć wykrywa stan przejściowy, który jest NORMALNY przez cały czas
# pracy ról w fazach 3 i 7. Skutek: bramka A nie mogła przejść, dopóki role pracowały,
# a jedynym sposobem jej zaliczenia byłoby skasowanie ich worktree wraz z pracą w toku.
# Wpis w rejestrze może być poprawny co do warunku i błędny co do KONSEKWENCJI.
# Rejestr wymaga rewizji tak samo jak kod — i tak samo musi ją dostawać przez skrypt,
# z RCA, a nie przez ręczną edycję.
#
# DOBÓR TRYBU (reguła wyprowadzona z RCA_T-ABC-2_A_1_171010.md)
#   empty  — stan, który NIGDY nie jest poprawny (np. zakazany idiom w kodzie)
#   obecny — rzecz wymagana, której brak jest błędem (np. bramka bezpieczeństwa w skrypcie)
#   raport — stan, który BYWA poprawny przejściowo (worktree ról, kontrakt przed recenzją)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${AIOS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
. "$SCRIPT_DIR/lib/aios-root.sh" 2>/dev/null || { echo "amend-pitfall: brak scripts/lib/aios-root.sh — powłoka niekompletna" >&2; exit 78; }
STATE="$(aios_state_root "$ROOT")"
REGISTRY="$ROOT/docs/STACK_PITFALLS.md"
RCA=""; ID=""; NOWY_TRYB=""

while [ $# -gt 0 ]; do
  case "$1" in
    --id)       ID="$2";        shift 2 ;;
    --tryb)     NOWY_TRYB="$2"; shift 2 ;;
    --registry) REGISTRY="$2";  shift 2 ;;
    -h|--help)  echo "użycie: amend-pitfall.sh <plik-RCA> --id P-K## --tryb empty|obecny|raport"; exit 0 ;;
    *)          RCA="$1";       shift ;;
  esac
done

[ -n "$RCA" ] || { echo "amend-pitfall: podaj plik RCA — korekta rejestru bez diagnozy nie istnieje" >&2; exit 64; }
[ -f "$RCA" ] || RCA="$ROOT/$RCA"
[ -f "$RCA" ] || { echo "amend-pitfall: nie znajduję RCA: $RCA" >&2; exit 66; }
[ -f "$REGISTRY" ] || { echo "amend-pitfall: nie znajduję rejestru: $REGISTRY" >&2; exit 66; }
[ -n "$ID" ] || { echo "amend-pitfall: podaj --id" >&2; exit 64; }
case "$NOWY_TRYB" in empty|obecny|raport) : ;; *) echo "amend-pitfall: --tryb wymaga empty|obecny|raport" >&2; exit 64 ;; esac

grep -q "^### \[$ID\]" "$REGISTRY" || { echo "amend-pitfall: brak wpisu [$ID] w rejestrze" >&2; exit 66; }

STARY_TRYB="$(awk -v id="$ID" '$0 ~ "^### \\[" id "\\]" {w=1; next} w && /^- tryb: /{sub(/^- tryb: /,""); print; exit}' "$REGISTRY")"
if [ "$STARY_TRYB" = "$NOWY_TRYB" ]; then
  echo "amend-pitfall: [$ID] już ma tryb '$NOWY_TRYB' — nic do zrobienia"; exit 0
fi

TMP="$(mktemp)"
awk -v id="$ID" -v nowy="$NOWY_TRYB" -v rca="$(basename "$RCA")" '
  $0 ~ "^### \\[" id "\\]" { w=1; print; next }
  w && /^- tryb: / { print "- tryb: " nowy; print "- korekta: tryb zmieniony przez amend-pitfall.sh (RCA " rca ")"; w=0; next }
  /^### \[P-/ { w=0 }
  { print }
' "$REGISTRY" > "$TMP" || { echo "amend-pitfall: generator zawiódł" >&2; rm -f "$TMP"; exit 70; }

# ── BRAMKA BEZPIECZEŃSTWA — ta sama zasada, co w add-pitfall.sh ──────────────
# Korekta wyłącznie podmienia linię i dokłada adnotację, więc wynik nigdy nie może być
# krótszy od oryginału. Rejestr jest pamięcią projektu: przy wątpliwości zostaw nietknięty.
LINES_OLD="$(wc -l < "$REGISTRY" | tr -d ' ')"
LINES_NEW="$(wc -l < "$TMP" | tr -d ' ')"
if [ ! -s "$TMP" ] || [ "$LINES_NEW" -lt "$LINES_OLD" ]; then
  echo "✗ amend-pitfall: PRZERWANE — wynik ($LINES_NEW linii) krótszy niż rejestr ($LINES_OLD)." >&2
  echo "  Rejestr NIE został zmieniony: $REGISTRY" >&2
  rm -f "$TMP"; exit 70
fi
mv "$TMP" "$REGISTRY"

echo "✓ [$ID]: tryb '$STARY_TRYB' → '$NOWY_TRYB' (źródło: $(basename "$RCA"))"
grep -A5 "^### \[$ID\]" "$REGISTRY" | sed 's/^/    /'

mkdir -p "$STATE/telemetry"
printf '{"ts":"%s","typ":"pitfall_amend","id":"%s","z":"%s","na":"%s","zrodlo":"%s"}\n' \
  "$(date -Iseconds)" "$ID" "$STARY_TRYB" "$NOWY_TRYB" "$(basename "$RCA")" >> "$STATE/telemetry/events.jsonl"

echo "  → preflight i bramka A stosują nowy tryb od następnego uruchomienia."
