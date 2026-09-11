#!/usr/bin/env bash
# AiOS r3 · hook PreCompact — świadek kompakcji.
# Uczciwie: hook nie zmusi modelu do zapisania stanu — od re-iniekcji stanu po
# kompakcji jest SessionStart. Ten hook robi to, co zrobić MOŻNA deterministycznie:
# dopisuje zdarzenie do telemetrii (postmortem widzi, KIEDY transkrypt był
# streszczany) i przypomina na stderr o aktualności PHASE_STATE.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/aios-root.sh" 2>/dev/null || exit 0
ROOT="$(aios_tree_root "$(pwd)")"
STATE="$(aios_state_root "$ROOT")"
cd "$ROOT" 2>/dev/null || exit 0

INPUT="$(cat)"
TRIGGER="auto"
printf '%s' "$INPUT" | grep -q '"trigger"[[:space:]]*:[[:space:]]*"manual"' && TRIGGER="manual"
TASK="-"; [ -f "$STATE/.aios/active_task" ] && TASK="$(cat "$STATE/.aios/active_task")"

mkdir -p "$STATE/telemetry"
printf '{"ts":"%s","typ":"compact","trigger":"%s","task":"%s"}\n' \
  "$(date -Iseconds)" "$TRIGGER" "$TASK" >> "$STATE/telemetry/events.jsonl"

echo "[AiOS powłoka] Kompakcja ($TRIGGER) — upewnij się, że PHASE_STATE odzwierciedla bieżący stan; po kompakcji SessionStart wstrzyknie go ponownie." >&2
exit 0
