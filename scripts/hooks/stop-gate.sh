#!/usr/bin/env bash
# AiOS r3 · hook Stop — DOMKNIĘCIE DoD NA POZIOMIE PLATFORMY.
# Gdy istnieją edycje bez zaliczonej bramki (.aios/dirty), hook odmawia
# zakończenia tury (exit 2) i odsyła sterowanie do agenta z instrukcją.
# Agent fizycznie nie może ogłosić „done" przed PASS.
# Bezpiecznik pętli: gdy stop_hook_active=true w wejściu — przepuszczamy,
# żeby hook nie blokował sam siebie w nieskończoność.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/aios-root.sh" 2>/dev/null || exit 0
ROOT="$(aios_tree_root "$(pwd)")"
STATE="$(aios_state_root "$ROOT")"
cd "$ROOT" 2>/dev/null || exit 0

INPUT="$(cat)"
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

[ -f "$STATE/.aios/dirty" ] || exit 0

TASK="<TASK>"; [ -f "$STATE/.aios/active_task" ] && TASK="$(cat "$STATE/.aios/active_task")"
{
  echo "[AiOS powłoka] Tura nie może się zakończyć: edycje bez zaliczonej bramki (dirty od $(cat "$STATE/.aios/dirty"))."
  echo "Uruchom: scripts/gate.sh A $TASK   (PASS zdejmuje blokadę; runtime: gate.sh B $TASK --routes \"/\")"
  echo "FAIL bramki => stub RCA + pole detect: przed retry — zgodnie z fazą 7."
} >&2
exit 2
