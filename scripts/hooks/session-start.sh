#!/usr/bin/env bash
# AiOS r3 · hook SessionStart — stdout tego skryptu jest DODAWANY DO KONTEKSTU.
# Wstrzykuje trwały stan protokołu na starcie sesji (startup / resume / po kompakcji),
# zdejmując z Arbitra obowiązek pamiętania (ryzyko R3 → zamknięte infrastrukturalnie).
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/aios-root.sh" 2>/dev/null || exit 0
ROOT="$(aios_tree_root "$(pwd)")"
STATE="$(aios_state_root "$ROOT")"
cd "$ROOT" 2>/dev/null || exit 0

FOUND=0
for f in docs/PHASE_STATE_*.md; do
  [ -e "$f" ] || continue
  FOUND=1
  echo "=== [AiOS powłoka] TRWAŁY STAN PROTOKOŁU: $f ==="
  sed -n '1,60p' "$f"
  echo "=== koniec $f ==="
done

if [ "$FOUND" -eq 0 ]; then
  echo "[AiOS powłoka] Brak aktywnych PHASE_STATE — nowe zadanie zaczyna się od fazy 0 (brief + DoD + File Map + PHASE_STATE z szablonu)."
fi

if [ -f "$STATE/.aios/dirty" ]; then
  echo "[AiOS powłoka] UWAGA: znacznik dirty aktywny — są edycje bez zaliczonej bramki. Pierwszy krok: scripts/gate.sh A <TASK>."
fi
if [ -f "$STATE/.aios/active_task" ]; then
  echo "[AiOS powłoka] Aktywne zadanie: $(cat "$STATE/.aios/active_task")"
else
  echo "[AiOS powłoka] UWAGA: brak wskaźnika .aios/active_task — strażnik File Map jest w trybie PRZEPUSZCZAJĄCYM w CAŁYM repozytorium. Zasiew (pierwsza czynność fazy 0): mkdir -p .aios && printf '%s' '<TASK>' > .aios/active_task"
fi
exit 0
