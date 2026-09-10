#!/usr/bin/env bash
# AiOS r3 · hook PostToolUse (Edit|Write|MultiEdit) — sprzężenie natychmiastowe.
# 1) Stawia znacznik .aios/dirty (edycje bez zaliczonej bramki) — zdejmuje go
#    wyłącznie PASS bramki (gate.sh). Znacznik zasila hook Stop.
# 2) Odpala preflight (detektory rejestru) od razu po edycji; przy FAIL kończy
#    się kodem 2 — stderr wraca do agenta jako błąd do naprawienia TERAZ,
#    zamiast czekać do bramki A.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/aios-root.sh" 2>/dev/null || exit 0
ROOT="$(aios_tree_root "$(pwd)")"
STATE="$(aios_state_root "$ROOT")"
cd "$ROOT" 2>/dev/null || exit 0
cat > /dev/null  # stdin JSON nieużywany; preflight patrzy na repo, nie na deltę

mkdir -p "$STATE/.aios"
date -Iseconds > "$STATE/.aios/dirty"

[ -x scripts/preflight.sh ] || exit 0
TASK="-"; [ -f "$STATE/.aios/active_task" ] && TASK="$(cat "$STATE/.aios/active_task")"
OUT="$(bash scripts/preflight.sh --task "$TASK" --quiet 2>&1)"; RC=$?
if [ $RC -ne 0 ]; then
  {
    echo "[AiOS powłoka] preflight po edycji: FAIL — napraw zanim pójdziesz dalej."
    bash scripts/preflight.sh --task "$TASK" 2>/dev/null | grep -A5 '\[FAIL\]' | head -20
  } >&2
  exit 2
fi
exit 0
