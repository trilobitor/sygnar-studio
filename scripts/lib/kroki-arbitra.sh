#!/usr/bin/env bash
# kroki-arbitra.sh — [P-H17] detektor: kroki z kontraktu (Regula K) kontra kroki
# wzmiankowane w PHASE_STATE (Gramatyka G). Patrz docs/contracts/T-ARB-1.kontrakt.md.
#
#   scripts/lib/kroki-arbitra.sh [<korzen>]      # <korzen> domyslnie `.`
#
# - Kod wyjscia ZAWSZE 0. Werdykt niesie stdout, nie kod (kontrakt SS2).
# - Czyta WYLACZNIE <korzen>/docs/contracts/*.kontrakt.md i
#   <korzen>/docs/PHASE_STATE_*.md. Nie wola `git`, nie pisze zadnego pliku,
#   nie robi `cd`, nie uzywa AIOS_ROOT.
# - Wyjscie: linie naruszen na stdout, jedna na linie, wylacznie ASCII. Brak
#   naruszen => zero bajtow na stdout.
# - Bez mapfile/readarray (P-H03, bash 3.2 na macOS), bez sed -i, bez set -e.
#
# Wydajnosc: petle po liniach uzywaja WYLACZNIE wbudowanych mechanizmow basha
# ([[ =~ ]], case, podstawianie parametrow) — zaden `grep`/`sed`/`tr` per linia,
# bo to wlasnie ta klasa regresji przechodzi pod progiem czasu bezglosnie
# (kontrakt SS6, przypis do P9b). Jedynym wolanym procesem zewnetrznym jest
# `sort` — raz na zadanie z brakujacymi krokami, nigdy w petli po liniach.
set -o pipefail

ROOT="${1:-.}"
KDIR="$ROOT/docs/contracts"

[ -d "$KDIR" ] || exit 0

TAB="$(printf '\t')"

# ── wzorce (regex w zmiennych, uzywane BEZ cudzyslowu po prawej stronie =~) ──
RE_HEADER='olejno.*(zmian|krok)'
RE_SEPLINE='^\|[ :|-]*$'
RE_CELL_NUM='^[0-9]+[a-z]?$'
# Koniec slowa z rdzeniem "krok" jest wyznaczany BAJTOWO, klasa dopelniajaca do
# separatorow Gramatyki G (cyfra/spacja/TAB/* /`/:/./,/;/(/)/-), NIE przez
# [[:alpha:]] — ta klasa kompiluje sie w biezacym LC_CTYPE i pod LC_ALL=C nie
# obejmuje bajtow >127 (polskie "ó" w "kroków" itp.), przez co dopasowanie
# konczylo sie w polowie slowa (I-1, faza 6). Cyfra jest w separatorach, zeby
# ciag liczb nigdy nie zostal wchloniety w rdzen (RE_NUM3B musi go zobaczyc).
RE_KROK_WORD='(^|[^[:alpha:]])(krok[^0-9 '"$TAB"'*`:.,;()-]*)'
RE_LEAD3A='^[ '"$TAB"'*`:.]*'
RE_NUM3B='^[0-9]+[a-z]?'
RE_RANGE3C='^[ '"$TAB"']*-[ '"$TAB"']*[0-9]+[a-z]?'
RE_RANGE_TAIL='([0-9]+[a-z]?)$'
RE_SEP3D='^[ '"$TAB"'*`]*(,|i|oraz)?[ '"$TAB"'*`]*'
RE_DIGIT_START='^[0-9]'
RE_PURE_NUM='^[0-9]+$'

# ── zbiory jako stringi z separatorem spacji, dedup przy dodawaniu ──────────
K_TOKENS=""
W_TOKENS=""
NONEMPTY_TASKS=""

add_k_token() {
  case " $K_TOKENS " in
    *" $1 "*) ;;
    *) K_TOKENS="$K_TOKENS $1" ;;
  esac
}

add_w_token() {
  case " $W_TOKENS " in
    *" $1 "*) ;;
    *) W_TOKENS="$W_TOKENS $1" ;;
  esac
}

count_tokens() {
  local s="$1" t n=0
  set -f
  for t in $s; do n=$((n + 1)); done
  set +f
  printf '%s' "$n"
}

count_pure_numeric_excl_zero() {
  local s="$1" t n=0
  set -f
  for t in $s; do
    if [[ "$t" =~ $RE_PURE_NUM ]]; then
      [ "$t" = "0" ] && continue
      n=$((n + 1))
    fi
  done
  set +f
  printf '%s' "$n"
}

# ── Regula K (kontrakt SS1.1) ────────────────────────────────────────────────
extract_K() {
  local file="$1" line found_header=0 in_table=0 rest cell
  K_TOKENS=""
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$found_header" -eq 0 ]; then
      case "$line" in
        '## '*)
          shopt -s nocasematch
          if [[ "$line" =~ $RE_HEADER ]]; then
            found_header=1
          fi
          shopt -u nocasematch
          ;;
      esac
      continue
    fi
    case "$line" in
      '## '*) break ;;
    esac
    case "$line" in
      '|'*)
        if [[ "$line" =~ $RE_SEPLINE ]]; then
          continue
        fi
        in_table=1
        rest="${line#|}"
        cell="${rest%%|*}"
        cell="${cell//\*/}"
        cell="${cell//\`/}"
        cell="${cell// /}"
        if [[ "$cell" =~ $RE_CELL_NUM ]]; then
          add_k_token "$cell"
        fi
        ;;
      *)
        if [ "$in_table" -eq 1 ]; then
          break
        fi
        ;;
    esac
  done < "$file"
}

# ── Gramatyka G — przebieg listy dla jednego wystapienia slowa na rdzeniu
#    krok (kontrakt SS1.2 pkt 3) ─────────────────────────────────────────────
run_traversal() {
  local s="$1" tok1 tok2 full n1 n2 i flag suf

  while :; do
    if [[ "$s" =~ $RE_LEAD3A ]]; then
      s="${s:${#BASH_REMATCH[0]}}"
    fi
    if [[ "$s" =~ $RE_NUM3B ]]; then
      tok1="${BASH_REMATCH[0]}"
    else
      break
    fi
    s="${s:${#tok1}}"
    add_w_token "$tok1"

    if [[ "$s" =~ $RE_RANGE3C ]]; then
      full="${BASH_REMATCH[0]}"
      if [[ "$full" =~ $RE_RANGE_TAIL ]]; then
        tok2="${BASH_REMATCH[1]}"
        n1="${tok1%[a-z]}"
        n2="${tok2%[a-z]}"
        n1=$((10#$n1))
        n2=$((10#$n2))
        if [ "$n2" -gt "$n1" ] && [ $((n2 - n1)) -lt 100 ]; then
          s="${s:${#full}}"
          add_w_token "$tok2"
          i=$((n1 + 1))
          while [ "$i" -lt "$n2" ]; do
            add_w_token "$i"
            i=$((i + 1))
          done
        fi
      fi
    fi

    if [[ "$s" =~ $RE_SEP3D ]]; then
      s="${s:${#BASH_REMATCH[0]}}"
    fi

    if [[ "$s" =~ $RE_DIGIT_START ]]; then
      continue
    else
      break
    fi
  done
}

extract_W() {
  local file="$1" line has remaining wholematch found
  W_TOKENS=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//–/-}"
    line="${line//—/-}"

    shopt -s nocasematch
    if [[ "$line" == *krok* ]]; then has=1; else has=0; fi
    shopt -u nocasematch
    [ "$has" -eq 1 ] || continue

    remaining="$line"
    while :; do
      shopt -s nocasematch
      if [[ "$remaining" =~ $RE_KROK_WORD ]]; then
        wholematch="${BASH_REMATCH[0]}"
        found=1
      else
        found=0
      fi
      shopt -u nocasematch
      [ "$found" -eq 1 ] || break
      remaining="${remaining#*"$wholematch"}"
      run_traversal "$remaining"
    done
  done < "$file"
}

# ── komunikaty (kontrakt SS3 — dosłownie) ────────────────────────────────────
emit_K1() { printf '%s\n' "kroki-arbitra [$1]: krok $2 jest w kontrakcie, a nie ma go w PHASE_STATE - wyliczenie Arbitra jest niekompletne"; }
emit_K2() { printf '%s\n' "kroki-arbitra [$1]: kontrakt definiuje $2 krokow, a docs/PHASE_STATE_$1.md nie istnieje - pomiar NIEWYKONANY"; }
emit_K3() { printf '%s\n' "kroki-arbitra [$1]: kontrakt definiuje $2 krokow, a docs/PHASE_STATE_$1.md nie zawiera ANI JEDNEJ wzmianki o kroku - pomiar NIEWYKONANY"; }
emit_K4() { printf '%s\n' "kroki-arbitra [$1]: PHASE_STATE wylicza kroki ($2 tokenow liczbowych), a kontrakt nie ma tabeli krokow pod naglowkiem typu \"Kolejnosc zmian\" - pomiar NIEWYKONANY"; }
emit_K6() { printf '%s\n' "kroki-arbitra [$1]: docs/PHASE_STATE_$1.md istnieje, ale nie da sie go odczytac - pomiar NIEWYKONANY"; }

# ── K1: K(T) \ W(T), posortowane rosnaco po czesci liczbowej, potem token
#    bez sufiksu przed tokenem z sufiksem, sufiksy alfabetycznie (kontrakt SS2) ─
emit_missing_sorted() {
  local T="$1" k n suf flag key keys=""

  set -f
  for k in $K_TOKENS; do
    case " $W_TOKENS " in
      *" $k "*) continue ;;
    esac
    n="${k%[a-z]}"
    suf="${k#$n}"
    n=$((10#$n))
    flag=0
    [ -n "$suf" ] && flag=1
    key="$(printf '%010d|%d%s|%s' "$n" "$flag" "$suf" "$k")"
    keys="${keys}${key}"$'\n'
  done
  set +f

  [ -n "$keys" ] || return 0
  printf '%s' "$keys" | LC_ALL=C sort | while IFS='|' read -r _ _ tok; do
    emit_K1 "$T" "$tok"
  done
}

# ── listowanie plikow, LC_ALL=C po nazwie (kontrakt SS2) ─────────────────────
sorted_glob() {
  local d="$1" pat="$2" f
  for f in "$d"/$pat; do
    [ -e "$f" ] && printf '%s\n' "$f"
  done | LC_ALL=C sort
}

# ── petla 1 (kontrakt SS2 kroki 1-5) ─────────────────────────────────────────
while IFS= read -r kfile; do
  [ -n "$kfile" ] || continue
  fname="${kfile##*/}"
  T="${fname%.kontrakt.md}"

  extract_K "$kfile"
  [ -n "$K_TOKENS" ] || continue

  NONEMPTY_TASKS="$NONEMPTY_TASKS $T"
  n_k="$(count_tokens "$K_TOKENS")"
  psfile="$ROOT/docs/PHASE_STATE_$T.md"

  if [ ! -e "$psfile" ]; then
    emit_K2 "$T" "$n_k"
    continue
  fi
  if [ ! -r "$psfile" ]; then
    emit_K6 "$T"
    continue
  fi

  extract_W "$psfile"
  if [ -z "$W_TOKENS" ]; then
    emit_K3 "$T" "$n_k"
    continue
  fi

  emit_missing_sorted "$T"
done < <(sorted_glob "$KDIR" '*.kontrakt.md')

# ── petla 2 — Regula F (kontrakt SS1.3, SS2 krok 6), osobna od petli 1 ───────
while IFS= read -r psfile; do
  [ -n "$psfile" ] || continue
  fname="${psfile##*/}"
  T="${fname#PHASE_STATE_}"
  T="${T%.md}"

  kfile="$ROOT/docs/contracts/$T.kontrakt.md"
  [ -f "$kfile" ] || continue

  case " $NONEMPTY_TASKS " in
    *" $T "*) continue ;;
  esac

  [ -r "$psfile" ] || continue

  extract_W "$psfile"
  n_f="$(count_pure_numeric_excl_zero "$W_TOKENS")"
  if [ "$n_f" -ge 2 ]; then
    emit_K4 "$T" "$n_f"
  fi
done < <(sorted_glob "$ROOT/docs" 'PHASE_STATE_*.md')

exit 0
