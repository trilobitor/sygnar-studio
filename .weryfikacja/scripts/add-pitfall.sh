#!/usr/bin/env bash
# AiOS Fazowy v1.0-S — ADD-PITFALL (domknięcie pętli uczenia)
# Bierze WYPEŁNIONE RCA i dopisuje z niego wpis-detektor do rejestru pułapek.
# Od tego momentu preflight (krok 0) i bramka A łapią ten błąd maszynowo.
#
#   add-pitfall.sh docs/rca/RCA_T-42_B_1.md [--registry PLIK] [--no-verify] [--dopuszcz-podobny "powód"]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${AIOS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
. "$SCRIPT_DIR/lib/aios-root.sh" 2>/dev/null || { echo "add-pitfall: brak scripts/lib/aios-root.sh — powłoka niekompletna" >&2; exit 78; }
STATE="$(aios_state_root "$ROOT")"
REGISTRY="$ROOT/docs/STACK_PITFALLS.md"
VERIFY=1
RCA=""
DOPUSZCZ=0
POWOD_PODOBNY=""
PODOBNY_DO=""
KOL_ID=""
KOL_SC=""
KOL_WYC=0

while [ $# -gt 0 ]; do
  case "$1" in
    --registry)  REGISTRY="$2"; shift 2 ;;
    --no-verify) VERIFY=0; shift ;;
    --dopuszcz-podobny) DOPUSZCZ=1; POWOD_PODOBNY="${2:-}"; if [ $# -ge 2 ]; then shift 2; else shift; fi ;;
    -h|--help) echo "użycie: add-pitfall.sh <plik-RCA> [--registry PLIK] [--no-verify] [--dopuszcz-podobny \"powód\"]"; exit 0 ;;
    *) RCA="$1"; shift ;;
  esac
done

[ -n "$RCA" ] || { echo "add-pitfall: podaj plik RCA" >&2; exit 64; }
[ -f "$RCA" ] || RCA="$ROOT/$RCA"
[ -f "$RCA" ] || { echo "add-pitfall: nie znajduję RCA: $RCA" >&2; exit 66; }
[ -f "$REGISTRY" ] || { echo "add-pitfall: nie znajduję rejestru: $REGISTRY" >&2; exit 66; }

field() { grep -m1 "^- $1: " "$RCA" | sed "s/^- $1: //"; }

TYTUL="$(field tytul)"
KAT="$(field kategoria)"
TRYB="$(field tryb)"
DETECT="$(field detect)"
FIX="$(field fix)"
ZRODLO="RCA $(basename "$RCA")"

err=0
case "$KAT" in A|B|C|D|E|F|G|H) : ;; *) echo "✗ kategoria: '$KAT' — wymagane A–H" >&2; err=1 ;; esac
case "$TRYB" in empty|obecny|raport) : ;; *) echo "✗ tryb: '$TRYB' — wymagane empty|obecny|raport" >&2; err=1 ;; esac
{ [ -z "$TYTUL" ] || printf '%s' "$TYTUL" | grep -q '^TODO'; } && { echo "✗ tytul: pusty lub TODO" >&2; err=1; }
{ [ -z "$DETECT" ] || printf '%s' "$DETECT" | grep -q '^TODO'; } && { echo "✗ detect: pusty lub TODO — bez detektora pętla uczenia nie istnieje" >&2; err=1; }
[ "$err" -eq 0 ] || { echo "add-pitfall: RCA niekompletne ($RCA) — uzupełnij powyższe pola." >&2; exit 65; }
{ [ -z "$FIX" ] || printf '%s' "$FIX" | grep -q '^TODO'; } && FIX="patrz RCA"

# ── kontrola treści: jedna lekcja = jeden wpis (T-REJ-1) ──────────────────────
# Porównuje "detect:" tego RCA, po normalizacji, z "detect:" KAŻDEGO wpisu
# rejestru (także wycofanego). Stoi PRZED generatorem identyfikatora (ADR B6):
# generator odrzuca dziś każdy wpis kategorii H, więc kontrola postawiona ZA nim
# byłaby w tej kategorii nieosiągalna.
PROG_PODOBIENSTWA=800
# 800 promili. Zmierzone kotwice (23 wpisy, 253 pary, faza 1 T-REJ-1):
#   862  P-H06/P-H10 — para, ktora MUSI byc zlapana
#   851  oprzyrzadowanie P-H13 — prog powyzej tej liczby CZERWIENI detektor P-H13
#   759  ten sam idiom, inny plik — MUSI przejsc (rozstrzygniecie fazy 2)
#   672  P-E01/P-F01 — najwyzszy falszywy alarm w rejestrze
# Przedzial dopuszczalny: [760, 851]. Zmiana progu wymaga ponownego pomiaru wszystkich czterech.

# stdin -> stdout, linia w linię. Bezstanowa, idempotentna.
# Reguły (ADR B2): N1 wyciszenia, N2 znaki cytowania, N3 białe znaki. NIC WIĘCEJ.
normalizuj_detect() {
  sed -e 's|2>[[:space:]]*/dev/null| |g' \
      -e 's|[[:space:]]*2>&1||g' \
      -e 's/["'"'"']/ /g' \
      -e 's/[[:space:]][[:space:]]*/ /g' \
      -e 's/^ *//' -e 's/ *$//'
}

# $1 = ścieżka rejestru
# $2 = plik z DOKŁADNIE JEDNĄ linią: znormalizowany detect kandydata (BEZ prefiksu pola)
# $3 = próg w promilach (liczba całkowita)
# stdout: zero lub więcej linii "PROMILE<TAB>ID<TAB>WYCOFANY", malejąco po PROMILE
# kod wyjścia: 0 = POMIAR WYKONANY (puste stdout = brak kolizji)
#              2 = POMIAR NIEWYKONALNY — wywołujący MUSI przerwać (B-2)
podobne_detect() {
  local reg="$1" cf="$2" prog="$3"
  local d idf detf normf rc HDRS DETS

  d="$(mktemp -d)" || { return 2; }
  idf="$d/ids"; detf="$d/dets"; normf="$d/dets.norm"
  : > "$idf"; : > "$detf"

  # faza parsera: pomija bloki ```` ``` ````, dla każdego wpisu ^### [P-…]
  # zapisuje "ID<TAB>0|1" do ids i "detect:" (po obcięciu prefiksu) do dets;
  # wpis bez detect: nie trafia do żadnego pliku (A5: wycofane liczą się na równi)
  awk -v idf="$idf" -v detf="$detf" '
    function flush() {
      if (id != "" && det != "") {
        print id "\t" wyc > idf
        print det > detf
      }
    }
    BEGIN { infence = 0; id = ""; wyc = 0; det = "" }
    /^```/ { infence = !infence; next }
    infence { next }
    /^### \[P-/ {
      flush()
      id = $0
      sub(/^### \[/, "", id)
      sub(/\].*$/, "", id)
      wyc = 0
      det = ""
      next
    }
    /^- wycofany: / { wyc = 1; next }
    /^- detect: / { det = substr($0, length("- detect: ") + 1); next }
    END { flush() }
  ' "$reg" > /dev/null 2> "$d/awk1.err"
  rc=$?
  [ "$rc" -eq 0 ] || { rm -rf "$d"; return 2; }

  # rejestr z ≥1 nagłówkiem, którego parser nie zdołał sparsować, jest
  # NIEWYKONALNY do pomiaru — cisza nie jest sukcesem (§2.2(d) przyp. 3)
  # JEDNA definicja nagłówka: liczymy tym samym przebiegiem co parser
  # (pomija ogrodzenia ``` ```), żeby rejestr złożony z SAMEGO NAGŁÓWKA
  # (poza ogrodzeniem, bez wpisów) dawał HDRS=0 → rejestr pusty, kod 0.
  HDRS="$(awk '/^```/{f=!f;next} !f && /^### \[P-/{c++} END{print c+0}' "$reg")"
  DETS="$(wc -l < "$detf" | tr -d ' ')"
  if [ "$HDRS" -ge 1 ] && [ "$DETS" -eq 0 ]; then rm -rf "$d"; return 2; fi

  normalizuj_detect < "$detf" > "$normf" 2> "$d/sed.err"
  rc=$?
  [ "$rc" -eq 0 ] || { rm -rf "$d"; return 2; }

  # faza miary: Dice na 5-gramach bajtowych, sparowana z ids po FNR
  awk -v cf="$cf" -v idf="$idf" -v prog="$prog" '
    function card(a,   k, c) { c = 0; for (k in a) c++; return c }
    function shing(s, a,   i, n) {
      split("", a)                          # D-12: przenośne czyszczenie tablicy w awk BSD;
                                            # `delete a` na parametrze tablicowym nie jest przenośne
      n = length(s)
      if (n <= 5) { a[s] = 1; return }      # linia krótsza niż 6 bajtów => porównanie przez równość
      for (i = 1; i <= n - 4; i++) a[substr(s, i, 5)] = 1
    }
    BEGIN {
      if ((getline cand < cf) <= 0) { exit 3 }
      close(cf)
      shing(cand, A)
      ua = card(A)
      n = 0
      while ((getline l < idf) > 0) { n++; ids[n] = l }
      close(idf)
    }
    {
      shing($0, B)
      inter = 0
      for (k in B) if (k in A) inter++
      ub = card(B)
      sc = 0
      if (ua + ub > 0) sc = int(2000 * inter / (ua + ub))
      if (sc >= prog) {
        split(ids[FNR], parts, "\t")
        printf "%d\t%s\t%s\n", sc, parts[1], parts[2]
      }
    }
  ' "$normf" > "$d/out" 2> "$d/awk2.err"
  rc=$?
  [ "$rc" -eq 0 ] || { rm -rf "$d"; return 2; }

  sort -rn "$d/out"
  rm -rf "$d"
  return 0
}

if [ "$DOPUSZCZ" -eq 1 ]; then
  if [ -z "$POWOD_PODOBNY" ]; then
    echo "✗ add-pitfall: --dopuszcz-podobny wymaga powodu w cudzyslowie." >&2
    exit 64
  fi
  case "$POWOD_PODOBNY" in
    TODO*)
      echo "✗ add-pitfall: PRZERWANE — powod obejscia nie moze byc TODO." >&2
      echo "  Rejestr NIE zostal zmieniony." >&2
      exit 65
      ;;
  esac
  if [ "${#POWOD_PODOBNY}" -lt 12 ]; then
    echo "✗ add-pitfall: PRZERWANE — powod obejscia ma ${#POWOD_PODOBNY} znakow; wymagane co najmniej 12." >&2
    echo "  Rejestr NIE zostal zmieniony." >&2
    exit 65
  fi
  if [ "$(printf '%s' "$POWOD_PODOBNY" | wc -l | tr -d ' ')" -ne 0 ]; then
    echo "✗ add-pitfall: PRZERWANE — powod obejscia zawiera znak nowej linii; rozcialby wpis dla parserow rejestru." >&2
    echo "  Rejestr NIE zostal zmieniony." >&2
    exit 65
  fi
fi

KAND="$(mktemp)" || { echo "add-pitfall: mktemp zawiodl — rejestr NIE zostal zmieniony." >&2; exit 70; }
trap 'rm -f "$KAND"' EXIT
printf '%s\n' "$DETECT" | normalizuj_detect > "$KAND"

KOLIZJE="$(podobne_detect "$REGISTRY" "$KAND" "$PROG_PODOBIENSTWA")"
POM_RC=$?
if [ "$POM_RC" -ne 0 ]; then
  echo "✗ add-pitfall: PRZERWANE — kontrola tresci nie mogla zostac wykonana; rejestr NIE zostal zmieniony." >&2
  exit 70
fi

if [ -n "$KOLIZJE" ]; then
  PIERWSZA="$(printf '%s\n' "$KOLIZJE" | head -1)"
  IFS=$'\t' read -r KOL_SC KOL_ID KOL_WYC <<EOF
$PIERWSZA
EOF
  if [ "$DOPUSZCZ" -eq 1 ]; then
    LISTA=""
    while IFS=$'\t' read -r SC ID WYC; do
      POZ="$ID ($SC/1000)"
      case "$WYC" in 1) POZ="$POZ (wycofany)" ;; esac
      if [ -z "$LISTA" ]; then LISTA="$POZ"; else LISTA="$LISTA, $POZ"; fi
    done <<EOF
$KOLIZJE
EOF
    PODOBNY_DO="
- podobny-do: $LISTA — $POWOD_PODOBNY"
  else
    cat >&2 <<EOF
✗ add-pitfall: PRZERWANE — detect z tego RCA powiela wpis $KOL_ID (podobienstwo $KOL_SC/1000, prog $PROG_PODOBIENSTWA).
EOF
    case "$KOL_WYC" in
      1) printf '  UWAGA: %s jest WYCOFANY. Duplikat wpisu wycofanego to powrot wady odstawionej swiadomie; jesli wycofanie bylo bledem: scripts/retire-pitfall.sh --przywroc %s\n' "$KOL_ID" "$KOL_ID" >&2 ;;
    esac
    RESZTA="$(printf '%s\n' "$KOLIZJE" | tail -n +2)"
    if [ -n "$RESZTA" ]; then
      while IFS=$'\t' read -r SC ID WYC; do
        printf '  koliduje takze: %s (%s/1000)\n' "$ID" "$SC" >&2
      done <<EOF
$RESZTA
EOF
    fi
    cat >&2 <<EOF
  Rejestr NIE zostal zmieniony: $REGISTRY
  Poprawka istniejacego detektora NIE jest nowym numerem. Dzis jedyna droga to:
    1) add-pitfall.sh … --dopuszcz-podobny "poprawka detektora $KOL_ID — <co sie zmienilo>"
    2) NATYCHMIAST scripts/retire-pitfall.sh $KOL_ID --powod "…" --zastapiony-przez <nowy ID>
  Krok 2 jest obowiazkowy: sekwencja urwana po kroku 1 zostawia w rejestrze CZYNNY duplikat.
  Jesli to naprawde nowa lekcja: --dopuszcz-podobny "<dlaczego to nie jest duplikat>"
EOF
    exit 70
  fi
else
  PODOBNY_DO=""
  if [ "$DOPUSZCZ" -eq 1 ]; then
    echo "  ⚠ --dopuszcz-podobny podano, ale zaden wpis nie przekracza progu — pole podobny-do NIE zostalo dopisane." >&2
  fi
fi

# ── kolejne ID w kategorii ────────────────────────────────────────────────────
LAST="$(grep -oE "^### \[P-${KAT}[0-9]+\]" "$REGISTRY" | grep -oE '[0-9]+' | sort -n | tail -1 || true)"
NEXT=$(( 10#${LAST:-0} + 1 ))
ID="$(printf 'P-%s%02d' "$KAT" "$NEXT")"
# Walidacja KSZTAŁTU wygenerowanego identyfikatora — [P-H04] mówi „bez sprawdzenia
# wyniku generatora", a przez osiem wpisów sprawdzaliśmy wyłącznie długość rezultatu
# i kod wyjścia awk. 2026-08-12 skrypt zapisał wpis z PUSTYM identyfikatorem
# (arytmetyka ósemkowa na "08"), a rejestr przyjął go w ciszy i preflight go nie widział.
# Identyfikator jest częścią wyniku generatora i od teraz jest częścią kontroli.
case "$ID" in
  P-[A-Z][0-9][0-9]) : ;;
  *) echo "✗ add-pitfall: PRZERWANE — wygenerowany identyfikator ma zły kształt: '\''$ID'\'' (kategoria='\''$KAT'\'', nastepny='\''$NEXT'\'')." >&2
     echo "  Rejestr NIE został zmieniony. Sprawdź pole '\''- kategoria:'\'' w RCA i numerację w rejestrze." >&2
     exit 70 ;;
esac
grep -q "^### \[$ID\]" "$REGISTRY" && { echo "✗ add-pitfall: PRZERWANE — identyfikator $ID już istnieje w rejestrze." >&2; exit 70; }

ENTRY="### [$ID] $TYTUL
- kategoria: $KAT
- tryb: $TRYB
- detect: $DETECT
- fix: $FIX
- zrodlo: $ZRODLO$PODOBNY_DO"

# ── wstawienie: koniec sekcji '## K.' albo nowa sekcja na końcu pliku ────────
# PRZENOŚNOŚĆ: wpis jest WIELOLINIOWY, a `awk -v zmienna="…"` z dosłownym znakiem
# nowej linii jest błędem w awk BSD (macOS): "newline in string". awk kończył się
# błędem, `> "$TMP"` zostawiał plik pusty, a bezwarunkowe `mv` nadpisywało rejestr
# pustką — narzędzie pętli uczenia kasowało dokładnie to, co miało wzbogacić.
# Wpis wędruje więc przez plik pomocniczy (getline), a podmiana ma bramkę niżej.
TMP="$(mktemp)"
ENTRY_F="$(mktemp)"
printf '%s\n' "$ENTRY" > "$ENTRY_F"
awk_rc=0
if grep -q "^## ${KAT}\." "$REGISTRY"; then
  awk -v kat="$KAT" -v ef="$ENTRY_F" '
    function wypisz_wpis(   l){ while((getline l < ef) > 0) print l; close(ef) }
    BEGIN{insec=0; done=0}
    /^## /{
      if(insec && !done){wypisz_wpis(); print ""; done=1}
      insec = ($0 ~ "^## " kat "\\.") ? 1 : 0
    }
    {print}
    END{if(insec && !done){print ""; wypisz_wpis()}}
  ' "$REGISTRY" > "$TMP" || awk_rc=$?
else
  cat "$REGISTRY" > "$TMP"
  { echo ""; echo "## ${KAT}. (nowa kategoria)"; echo ""; printf '%s\n' "$ENTRY"; } >> "$TMP"
fi
rm -f "$ENTRY_F"

# ── BRAMKA BEZPIECZEŃSTWA: nigdy nie nadpisuj rejestru wynikiem, który go gubi ──
# Wpis wyłącznie DOPISUJEMY, więc wynik krótszy od oryginału zawsze oznacza awarię
# generatora. Rejestr jest pamięcią projektu — jego utrata kosztuje więcej niż
# nieudane dopisanie jednego detektora. Przy wątpliwości: zostaw plik nietknięty.
LINES_OLD="$(wc -l < "$REGISTRY" | tr -d ' ')"
LINES_NEW="$(wc -l < "$TMP" | tr -d ' ')"
if [ "$awk_rc" -ne 0 ] || [ ! -s "$TMP" ] || [ "$LINES_NEW" -lt "$LINES_OLD" ]; then
  echo "✗ add-pitfall: PRZERWANE — generator zawiódł (rc=$awk_rc) albo wynik ($LINES_NEW linii) jest krótszy niż rejestr ($LINES_OLD)." >&2
  echo "  Rejestr NIE został zmieniony: $REGISTRY" >&2
  rm -f "$TMP"
  exit 70
fi
mv "$TMP" "$REGISTRY"

echo "✓ dopisano do rejestru: [$ID] $TYTUL"
printf '%s\n' "$ENTRY" | sed 's/^/    /'

if [ -n "$PODOBNY_DO" ]; then
  cat >&2 <<EOF
  ⚠ [$ID] dopisano MIMO kolizji z $KOL_ID ($KOL_SC/1000). Rejestr ma teraz DWA czynne wpisy o zblizonej tresci.
    Jesli to POPRAWKA detektora, a nie nowa lekcja — krok 2 jest OBOWIAZKOWY i NIE zostal wykonany:
      scripts/retire-pitfall.sh $KOL_ID --powod "<dlaczego>" --zastapiony-przez $ID
EOF
fi

if [ "$VERIFY" -eq 1 ]; then
  cd "$ROOT"
  OUT="$(bash -c "$DETECT" 2>/dev/null || true)"
  N=0; [ -n "$OUT" ] && N="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
  case "$TRYB" in
    empty)  echo "  weryfikacja: trafień teraz: $N (po poprawce oczekuj 0; na kodzie sprzed poprawki powinno być >0)" ;;
    obecny) echo "  weryfikacja: trafień teraz: $N (tryb 'obecny' — po poprawce oczekuj >0)" ;;
    raport) echo "  weryfikacja: trafień teraz: $N (tryb 'raport' — informacyjnie)" ;;
  esac
fi

mkdir -p "$STATE/telemetry"
printf '{"ts":"%s","typ":"pitfall","id":"%s","kategoria":"%s","zrodlo":"%s"}\n' \
  "$(date -Iseconds)" "$ID" "$KAT" "$(basename "$RCA")" >> "$STATE/telemetry/events.jsonl"

echo "  → od teraz krok 0 (preflight) i bramka A łapią ten błąd automatycznie."
