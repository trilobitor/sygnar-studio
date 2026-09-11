#!/usr/bin/env bash
# AiOS r3 · hook PreToolUse (Edit|Write|MultiEdit) — STRAŻNIK FILE MAP.
# Czyta JSON ze stdin, porównuje tool_input.file_path z File Map aktywnego zadania
# i przy naruszeniu kończy się kodem 2: narzędzie jest blokowane ZANIM zadziała,
# a stderr wraca do agenta jako powód. Zakaz przestaje być instrukcją — jest fizyką.
#
# File Map: docs/contracts/<TASK>.filemap — linie "rola: wzorzec", np.
#   impl-frontend: components/**
#   impl-frontend: app/(site)/**
#   impl-backend: app/api/**
#   tester: tests/**
# Aktywne zadanie i mapa są STANEM REPOZYTORIUM (scripts/lib/aios-root.sh), nie
# plikami drzewa roboczego (T-SHELL-1 naprawia P1: worktree bez wskaźnika = fail-open
# w gicie, a mechanizm dziś się nie zmienił). Mapa jest czytana najpierw z WŁASNEGO
# drzewa roli (ROOT); gdy jej tam nie ma, z drzewa głównego (STATE) — z ostrzeżeniem
# na stderr (ADR D-6).
# Świadome fail-open: brak filemap (w obu miejscach) / brak active_task / brak
# agent_type (sesja główna = Arbiter) / niewczytywalna biblioteka ⇒ przepuść.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/aios-root.sh" 2>/dev/null || exit 0
ROOT="$(aios_tree_root "$(pwd)")"
STATE="$(aios_state_root "$ROOT")"
cd "$ROOT" 2>/dev/null || exit 0

INPUT="$(cat)"
[ -f "$STATE/.aios/active_task" ] || exit 0
TASK="$(cat "$STATE/.aios/active_task")"
MAP="$ROOT/docs/contracts/${TASK}.filemap"
if [ ! -f "$MAP" ]; then
  MAP="$STATE/docs/contracts/${TASK}.filemap"
  [ -f "$MAP" ] && printf '%s\n' "[AiOS powloka] File Map wzieta z GLOWNEGO drzewa roboczego - w Twoim drzewie jej nie ma (krok 0 roli)." >&2
fi
[ -f "$MAP" ] || exit 0

printf '%s' "$INPUT" | python3 "$(dirname "${BASH_SOURCE[0]}")/filemap-guard.py" "$MAP" "$ROOT"
exit $?
