#!/usr/bin/env bash
# klasyfikacja-arbitra.sh -- [P-H18] detektor: zadanie zadeklarowane jako
# PELNY (Regula T), ktorego File Mapa nie potwierdza maszynowo zadnej klauzuli
# SKILL.md sekcja 2 (Regula M: neg F i neg G), a brief nie ma zapisanego
# powodu (Regula U). Patrz docs/contracts/T-KLAS-1.kontrakt.md.
#
#   scripts/lib/klasyfikacja-arbitra.sh [<korzen>]      # <korzen> domyslnie `.`
#
# - Kod wyjscia ZAWSZE 0. Werdykt niesie stdout, nie kod (kontrakt SS2).
# - Czyta WYLACZNIE <korzen>/docs/PHASE_STATE_*.md, docs/contracts/*.filemap,
#   docs/contracts/*.kontrakt.md (samo istnienie) i docs/briefs/*.md. Nie
#   wola `git`, nie pisze zadnego pliku, nie robi `cd`, nie uzywa AIOS_ROOT.
# - STDOUT: jedna linia na naruszenie, wylacznie ASCII (zaden bajt > 127).
#   STDERR: zero bajtow zawsze. Brak naruszen => zero bajtow na stdout.
# - Bez mapfile/readarray (P-H03, bash 3.2), bez sed -i, bez set -e,
#   bez set -o nullglob, bez cd, bez AIOS_ROOT.
# - `set -o pipefail` swiadomie POMINIETY: skrypt nie ma `set -e` i nigdzie
#   nie sprawdza $? potoku w warunku, wiec pipefail nie zabezpieczylby
#   niczego -- kazde ustawienie powloki bez swiadka jest dlugiem, nie
#   ostroznoscia (por. uzasadnienie zakazu nullglob w kontrakcie SS2, ktore
#   przy wywolaniu skryptu jako oddzielnego procesu `bash klasyfikacja-arbitra.sh`
#   z linii detect: rowniez nie ma efektu wyciekania do preflight.sh).
# - Zero podprocesow w petli po liniach -- parsowanie linii jest CZYSTYM
#   bashem (case, parametry, funkcje bez $(...) w petli). Jedynymi wolanymi
#   procesami sa `sort` (raz na przebieg, na liste plikow, NIE w petli po
#   liniach) oraz `tr`/`wc` (co najwyzej dwa razy NA PLIK, przy Regule T
#   i przy Regule U -- koszt staly na plik, dopuszczalny kontraktem SS2).
# - Glob bez nullglob: pozycja jest pomijana WYLACZNIE gdy jest bajtowo
#   rowna wzorcowi petli po podstawieniu korzenia; kazda inna pozycja
#   nieotwieralna daje K5/K6. `[ -e "$f" ] || continue` jest ZAKAZANE
#   (kontrakt SS2, D-5 rundy 3) -- nie odroznia niedopasowanego globu od
#   zerwanego dowiazania.
# - "Nieczytelne" (kontrakt SS1.4; rozstrzygniecia Arbitra R3-1 i R3-4 w
#   docs/reviews/T-KLAS-1.faza3-rozstrzygniecia-arbitra.md): JEDNA definicja
#   dla wszystkich TRZECH wejsc -- funkcja is_readable() nizej, jedyne
#   zrodlo warunku `[ -f X ] && [ -r X ]`. Katalog i potok nazwany maja
#   `-e`=T, `-r`=T, `-f`=F, wiec bez koniunktu `-f` katalog wypisuje
#   diagnostyke na stderr, a potok nazwany (`while read < <potok>`) NIE
#   WRACA NIGDY -- koniunkt `-f` jest warunkiem ZAKONCZENIA, nie ostroznoscia.
# - "Istnieje" (kontrakt SS1.4, R3-9): DRUGA JEDNA definicja, dla wszystkich
#   TRZECH wejsc -- funkcja is_entry_present() nizej, jedyne zrodlo warunku
#   `[ -e X ] || [ -L X ]`. To jest istnienie WPISU KATALOGOWEGO, nie celu
#   dowiazania -- sam `-e` podaza za dowiazaniem, wiec zerwane dowiazanie i
#   petla dowiazan dawaly pod samym `-e` DWIE WZAJEMNIE SPRZECZNE LINIE na
#   jedno zadanie (K6 z przebiegu pierwszego, ktory idzie za globem, i K9 z
#   przebiegu drugiego, ktory pytal `-e`). Kolejnosc warstw jest wiazaca:
#   ISTNIEJE przed CZYTELNE (SS1.4, SS2 poz. 5) -- zerwane dowiazanie i
#   petla dowiazan naleza teraz do K10/K5 (wpis istnieje, plik nieczytelny),
#   nie do K7/K4 (te sa dla BRAKU wpisu).

ROOT="${1:-.}"

[ -d "$ROOT/docs" ] || exit 0

TAB=$'\t'
SP=' '

# ── pomocnicze operujace na globalnym _S, bez $(...) (bez forka) ────────────

lstrip_markers() {
  # Zdejmuje wiodace '-', '*', '`', spacje, TAB -- w dowolnej kolejnosci, az
  # zaden juz nie pasuje (Regula T SS1.1, kotwica Reguly U SS1.3).
  local changed=1
  while [ "$changed" = 1 ]; do
    changed=0
    case "$_S" in
      -*) _S="${_S#-}"; changed=1 ;;
    esac
    case "$_S" in
      \**) _S="${_S#\*}"; changed=1 ;;
    esac
    case "$_S" in
      \`*) _S="${_S#\`}"; changed=1 ;;
    esac
    case "$_S" in
      " "*) _S="${_S# }"; changed=1 ;;
    esac
    case "$_S" in
      "$TAB"*) _S="${_S#"$TAB"}"; changed=1 ;;
    esac
  done
}

trim() {
  # strip() rownowazny Pythonowi (spacja + TAB, oba konce) na globalnym _S --
  # uzywane przez Regule M (parser File Mapy, kopia logiki filemap-guard.py
  # :63-70) i Regule U (linia koncowa ciala).
  local changed=1
  while [ "$changed" = 1 ]; do
    changed=0
    case "$_S" in
      " "*) _S="${_S# }"; changed=1 ;;
    esac
    case "$_S" in
      "$TAB"*) _S="${_S#"$TAB"}"; changed=1 ;;
    esac
  done
  changed=1
  while [ "$changed" = 1 ]; do
    changed=0
    case "$_S" in
      *" ") _S="${_S% }"; changed=1 ;;
    esac
    case "$_S" in
      *"$TAB") _S="${_S%"$TAB"}"; changed=1 ;;
    esac
  done
}

# ── SS1.4: JEDNA definicja "czytelne" dla wszystkich trzech wejsc ──────────
is_readable() {
  # $1 = sciezka. Czytelne wtw jest zwyklym plikiem PO ROZWINIECIU DOWIAZAN
  # (-f) I ma prawo odczytu (-r). Kazdy inny stan (katalog, potok nazwany,
  # zerwane dowiazanie, plik bez prawa odczytu) jest nieczytelny -- K6/K5/K10
  # wedle wejscia wywolujacego. Jedno zrodlo warunku (SS1.4, R3-4).
  [ -f "$1" ] && [ -r "$1" ]
}

# ── SS1.4: JEDNA definicja "istnieje" (wpis katalogowy) dla wszystkich ─────
# trzech wejsc -- R3-9.
is_entry_present() {
  # $1 = sciezka. Istnieje wtw jest wpisem katalogowym -- `-e` (podaza za
  # dowiazaniem) LUB `-L` (sam wpis jest dowiazaniem, nawet zerwanym albo
  # zapetlonym). Rozne od CZYTELNE: zerwane dowiazanie i petla dowiazan
  # ISTNIEJA, ale nie sa CZYTELNE. Jedno zrodlo warunku (SS1.4, R3-9).
  [ -e "$1" ] || [ -L "$1" ]
}

# ── listowanie plikow zgodnie z SS2: pomijana WYLACZNIE literalna pozycja ───
sorted_glob() {
  # $1 = katalog, $2 = wzorzec (np. 'PHASE_STATE_*.md'). Wypisuje sciezki
  # posortowane LC_ALL=C. Pomija WYLACZNIE pozycje bajtowo rowna "$1/$2"
  # (glob bez nullglob zostawia niedopasowany wzorzec literalem) -- kazda
  # inna pozycja idzie dalej, nawet gdy jest nieotwieralna albo zerwanym
  # dowiazaniem (D-5 rundy 3, P17, P10 wariant trzeci).
  local d="$1" pat="$2" f lit="$1/$2"
  for f in "$d"/$pat; do
    if [ "$f" = "$lit" ]; then
      continue
    fi
    printf '%s\n' "$f"
  done | LC_ALL=C sort
}

# ── emitery komunikatow -- bajtowo z kontraktu SS3, bez modyfikacji ─────────
emit_K1() { printf '%s\n' "klasyfikacja-arbitra [$1]: tryb PELNY; docs/contracts/$1.filemap ma $2 wzorcow produkcyjnych, zero roli frontendowej, zero wzorcow otwartych - zadna klauzula SKILL.md sekcja 2 nie jest z niej stwierdzalna maszynowo; docs/briefs/$1.md nie ma linii uzasadnienie_trybu:"; }
emit_K2() { printf '%s\n' "klasyfikacja-arbitra [$1]: tryb PELNY; docs/contracts/$1.filemap ma $2 wzorcow produkcyjnych, zero roli frontendowej, zero wzorcow otwartych; uzasadnienie_trybu: w docs/briefs/$1.md ma $3 liter i cyfr, wymagane 30"; }
emit_K3() { printf '%s\n' "klasyfikacja-arbitra [$1]: docs/PHASE_STATE_$1.md nie deklaruje trybu w rozpoznawalnej formie (oczekiwane PELNY albo SKROCONY) - pomiar NIEWYKONANY"; }
emit_K4() { printf '%s\n' "klasyfikacja-arbitra [$1]: docs/contracts/$1.kontrakt.md istnieje, a docs/contracts/$1.filemap nie - ksztaltu zadania nie da sie zmierzyc - pomiar NIEWYKONANY"; }
emit_K5() { printf '%s\n' "klasyfikacja-arbitra [$1]: docs/contracts/$1.filemap istnieje, ale nie da sie jej odczytac - pomiar NIEWYKONANY"; }
emit_K6() { printf '%s\n' "klasyfikacja-arbitra [$1]: docs/PHASE_STATE_$1.md istnieje, ale nie da sie go odczytac - pomiar NIEWYKONANY"; }
emit_K7() { printf '%s\n' "klasyfikacja-arbitra [$1]: tryb PELNY; docs/contracts/$1.filemap ma $2 wzorcow produkcyjnych, zero roli frontendowej, zero wzorcow otwartych; docs/briefs/$1.md nie istnieje - powod nie ma gdzie byc zapisany - pomiar NIEWYKONANY"; }
emit_K9() { printf '%s\n' "klasyfikacja-arbitra [$1]: docs/contracts/$1.filemap istnieje, a docs/PHASE_STATE_$1.md nie - trybu nie da sie odczytac - pomiar NIEWYKONANY"; }
emit_K10() { printf '%s\n' "klasyfikacja-arbitra [$1]: docs/briefs/$1.md istnieje, ale nie da sie go odczytac - pomiar NIEWYKONANY"; }

# ═════════════════════ przebieg pierwszy (kontrakt SS2 kroki 1-5) ══════════
while IFS= read -r psfile; do
  [ -n "$psfile" ] || continue
  fname="${psfile##*/}"
  T="${fname#PHASE_STATE_}"
  T="${T%.md}"

  # ── SS1.4: wiersz "PHASE_STATE nieczytelny" jest PIERWSZY w tabeli ──────
  if ! is_readable "$psfile"; then
    emit_K6 "$T"
    continue
  fi

  # ── Regula T (SS1.1) -- pierwsza linia "tryb:", reszta linii ignorowana ──
  found=0
  val=""
  while IFS= read -r line || [ -n "$line" ]; do
    _S="$line"
    lstrip_markers
    case "$_S" in
      [Tt][Rr][Yy][Bb]:*)
        found=1
        val="${_S#*:}"
        break
        ;;
    esac
  done < "$psfile"

  if [ "$found" != 1 ]; then
    emit_K3 "$T"
    continue
  fi

  val="${val//\*/}"
  val="${val//\`/}"
  _S="$val"
  changed=1
  while [ "$changed" = 1 ]; do
    changed=0
    case "$_S" in
      " "*) _S="${_S# }"; changed=1 ;;
    esac
    case "$_S" in
      "$TAB"*) _S="${_S#"$TAB"}"; changed=1 ;;
    esac
  done
  val="$_S"
  tok="${val%%[$SP$TAB]*}"

  # SS1.1 poz. 3 -- ASCII na wielkie, potem usuniecie kazdego bajtu spoza
  # A-Z (Ł/Ó sa wielobajtowe, tr '[:lower:]' '[:upper:]' ich nie dotyka).
  norm="$(printf '%s' "$tok" | LC_ALL=C tr 'a-z' 'A-Z' | LC_ALL=C tr -dc 'A-Z')"

  case "$norm" in
    PELNY|PENY) D=PELNY ;;
    SKROCONY|SKRCONY) D=SKROCONY ;;
    *) D="" ;;
  esac

  if [ -z "$D" ]; then
    emit_K3 "$T"
    continue
  fi

  if [ "$D" != "PELNY" ]; then
    continue
  fi

  # ── SS2 krok 3: File Mapa / kontrakt.md ──────────────────────────────────
  FM="$ROOT/docs/contracts/$T.filemap"
  KM="$ROOT/docs/contracts/$T.kontrakt.md"

  if ! is_entry_present "$FM" && ! is_entry_present "$KM"; then
    continue
  fi
  if ! is_entry_present "$FM"; then
    emit_K4 "$T"
    continue
  fi
  if ! is_readable "$FM"; then
    emit_K5 "$T"
    continue
  fi

  # ── Regula M (SS1.2) -- logika filemap-guard.py:63-70 ───────────────────
  F=0
  G=0
  P=0
  while IFS= read -r fline || [ -n "$fline" ]; do
    _S="$fline"
    trim
    [ -n "$_S" ] || continue
    case "$_S" in
      "#"*) continue ;;
    esac
    case "$_S" in
      *:*) ;;
      *) continue ;;
    esac
    role="${_S%%:*}"
    pat="${_S#*:}"
    _S="$role"; trim; role="$_S"
    _S="$pat"; trim; pat="$_S"

    if [ "$role" != "tester" ]; then
      P=$((P + 1))
      case "$pat" in
        *"*"*) G=1 ;;
      esac
    fi
    case "$role" in
      impl-frontend*) F=1 ;;
    esac
  done < "$FM"

  if [ "$F" = 1 ] || [ "$G" = 1 ]; then
    continue
  fi

  # ── SS2 krok 5: brief + Regula U (SS1.3) ─────────────────────────────────
  BRIEF="$ROOT/docs/briefs/$T.md"
  if ! is_entry_present "$BRIEF"; then
    emit_K7 "$T" "$P"
    continue
  fi
  # ── SS1.4/R3-1/R3-9: wpis istnieje, ale plik nieczytelny (K10). Zerwane ──
  # dowiazanie i petla dowiazan naleza tutaj (ISTNIEJE=T, CZYTELNE=F), nie
  # do K7 (ktore jest dla BRAKU wpisu).
  if ! is_readable "$BRIEF"; then
    emit_K10 "$T"
    continue
  fi

  anchor_found=0
  body=""
  body_has_content=0
  while IFS= read -r bline || [ -n "$bline" ]; do
    if [ "$anchor_found" = 0 ]; then
      _S="$bline"
      lstrip_markers
      case "$_S" in
        [Uu][Zz][Aa][Ss][Aa][Dd][Nn][Ii][Ee][Nn][Ii][Ee]_[Tt][Rr][Yy][Bb][Uu]:*)
          anchor_found=1
          rest="${_S#*:}"
          body="$rest"
          _S="$rest"; trim
          [ -n "$_S" ] && body_has_content=1
          ;;
      esac
      continue
    fi

    _S="$bline"
    trim
    stripped="$_S"

    terminate=0
    case "$stripped" in
      "#"*) terminate=1 ;;
    esac
    if [ "$terminate" = 0 ]; then
      case "$stripped" in
        "-") terminate=1 ;;
        "-"[$SP$TAB]*) terminate=1 ;;
        "*") terminate=1 ;;
        "*"[$SP$TAB]*) terminate=1 ;;
        "+") terminate=1 ;;
        "+"[$SP$TAB]*) terminate=1 ;;
      esac
    fi
    if [ "$terminate" = 1 ]; then
      break
    fi

    if [ -z "$stripped" ]; then
      if [ "$body_has_content" = 1 ]; then
        break
      fi
      continue
    fi

    body="$body
$bline"
    body_has_content=1
  done < "$BRIEF"

  if [ "$anchor_found" = 0 ]; then
    emit_K1 "$T" "$P"
    continue
  fi

  Ucount="$(printf '%s' "$body" | LC_ALL=C tr -dc '0-9A-Za-z\303-\305' | LC_ALL=C wc -c)"
  Ucount="${Ucount// /}"

  if [ "$Ucount" -lt 30 ]; then
    emit_K2 "$T" "$P" "$Ucount"
  fi
done < <(sorted_glob "$ROOT/docs" 'PHASE_STATE_*.md')

# ═════════════════════ przebieg drugi (kontrakt SS2 krok 6) -- K9 ═════════
while IFS= read -r fmfile; do
  [ -n "$fmfile" ] || continue
  fname="${fmfile##*/}"
  T="${fname%.filemap}"
  psfile="$ROOT/docs/PHASE_STATE_$T.md"
  # ── SS2 poz. 6/R3-9: predykat wpisu (nie -e) jest warunkiem ROZLACZNOSCI ─
  # przebiegow -- pod samym -e zerwane dowiazanie/petla dowiazan trafialy
  # jednoczesnie do K6 (przebieg pierwszy, idzie za globem) i K9 (ten test).
  if ! is_entry_present "$psfile"; then
    emit_K9 "$T"
  fi
done < <(sorted_glob "$ROOT/docs/contracts" '*.filemap')

exit 0
