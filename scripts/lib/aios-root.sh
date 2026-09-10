#!/usr/bin/env bash
# AiOS Fazowy — biblioteka rozstrzygania DWÓCH korzeni (T-SHELL-1).
# ROOT (drzewo robocze) i STATE (stan powłoki: .aios/, telemetry/) NIE są tym
# samym katalogiem, gdy proces biegnie w worktree: ROOT jest drzewem, w którym
# proces pracuje; STATE jest zawsze wspólnym drzewem głównym repozytorium,
# żeby licznik iteracji i telemetria nie rozjeżdżały się per worktree (R2/R3).
#
# Jedyne miejsce w repozytorium, w którym wolno wołać `--git-common-dir` albo
# `--show-toplevel` do liczenia POŁOŻENIA STANU POWŁOKI (kontrakt §10 poz. 2).
#
# Bez `set -e` (plik jest wołany przez `source` do skryptów z `set -uo pipefail`)
# i bez `mapfile`/`readarray` (P-H03: bash 3.2 na macOS).
#
#   aios_state_root <fallback>   → stdout: JEDNA linia. Zawsze kod 0.
#   aios_tree_root  <fallback>   → stdout: JEDNA linia. Zawsze kod 0.
#
# Kolejność rozstrzygania w OBU funkcjach (nie wolno przestawiać — §10 poz. 5):
#   1) AIOS_ROOT, jeżeli ustawione — dosłownie, nawet jeśli względne (R3).
#   2) wspólny katalog gita (state) / --show-toplevel (tree).
#   3) <fallback>.

aios_state_root() {
  local fallback="$1" c s
  if [ -n "${AIOS_ROOT:-}" ]; then
    printf '%s\n' "$AIOS_ROOT"
    return 0
  fi
  c="$(git rev-parse --git-common-dir 2>/dev/null)"
  if [ -n "$c" ]; then
    c="$(cd "$c" 2>/dev/null && pwd -P)"
  fi
  if [ -n "$c" ]; then
    s="$(dirname "$c")"
    if [ -d "$s" ] && [ -e "$s/.git" ]; then
      printf '%s\n' "$s"
      return 0
    fi
  fi
  printf '%s\n' "$fallback"
  return 0
}

aios_tree_root() {
  local fallback="$1" t
  if [ -n "${AIOS_ROOT:-}" ]; then
    printf '%s\n' "$AIOS_ROOT"
    return 0
  fi
  t="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$t" ] && [ -d "$t" ]; then
    printf '%s\n' "$t"
    return 0
  fi
  printf '%s\n' "$fallback"
  return 0
}
