---
name: hait-fazowy
description: >-
  Protokół fazowy AiOS v1.0-S — orkiestracja zespołu subagentów (Arbiter + 5 ról) w 9 fazach z
  deterministycznym kręgosłupem bramek, rejestrem pułapek z wykonywalnymi detektorami i pętlą
  uczenia FAIL→detektor. Używaj ZAWSZE, gdy zadanie dotyczy wdrożenia funkcjonalności, sekcji,
  strony, API lub poprawki w projekcie aplikacyjnym — także gdy użytkownik nie mówi wprost
  „protokół": hasła typu „zbuduj", „wdróż", „dodaj sekcję", „napraw", „faza", „bramka",
  „arbiter", „zespół", „dostarczenie", „modyfikacja", „88Done" uruchamiają ten skill.
  Zaprojektowany pod abonament (Claude Code / Max): Opus 4.8 dla osądu, Sonnet 5 dla wolumenu,
  zero API.
---

# AiOS Fazowy v1.0-S (r3) — protokół 9 faz z deterministycznym kręgosłupem i powłoką infrastrukturalną

Następca AiOS v0.2. Rdzeń zmiany: **model nie jest już jedynym strażnikiem jakości.**
Osąd zostaje u agentów, fakty rozstrzygają skrypty, dane żyją w plikach, sterowanie
płynie gwiazdą przez Arbitra. Każda porażka bramki obowiązkowo zostawia po sobie
detektor — projekt nabiera odporności z każdym FAIL.

## 0. Zasada czterech płaszczyzn (fundament — nie negocjujemy)

| Płaszczyzna | Nośnik | Rozstrzyga o… | Przykład |
|---|---|---|---|
| Osąd | agenci (konsensus) | jakość projektu, akceptowalność | przegląd kontraktu, odbiór |
| Fakt | skrypty (bramki) | build, testy, zgodność, idiomy | `gate.sh A/B/C`, `preflight.sh` |
| Dane | pliki | treść pracy | `kontrakt.md`, diffy, `PHASE_STATE` |
| Sterowanie | gwiazda (Arbiter) | kto, co, kiedy | przydziały, werdykty, eskalacje |

Konsekwencje: **agenci nigdy nie głosują nad faktami** (czy build przechodzi — mówi
skrypt), a **Arbiter nigdy nie przenosi treści** — przekazuje referencje do plików.

## 1. Zespół i routing modeli (abonament, bez API)

| Rola | Model | Profil (Gallup — skrót) | Zakres |
|---|---|---|---|
| **Arbiter** | Opus 4.8 | Command · Arranger · Responsibility | maszyna stanów protokołu; jedyny kanał sterowania; pisze PHASE_STATE |
| **Architekt** | Opus 4.8 | Strategic · Futuristic · Analytical | ADR, `kontrakt.md`, File Map (rozłączne pliki dla równoległości) |
| **Impl-Backend** | Sonnet 5 | Achiever · Focus · Discipline | API, walidacja (safeParse), dane; tylko pliki z File Map |
| **Impl-Frontend** | Sonnet 5 | Achiever · Learner · Ideation | UI, motion/react, a11y; tylko pliki z File Map |
| **Tester** | Sonnet 5 | Deliberative · Analytical | testy jako deliverable: unit + integracyjne + smoke E2E |
| **Recenzent** | Opus 4.8 | Deliberative · Analytical · Maximizer | **ślepy**: dostaje diff + kontrakt + screenshoty; nie widzi rozmów |

Reguły topologii (twarde):
- **Zakaz agent↔agent.** Cała komunikacja przez Arbitra. Subagent = izolowany kontekst.
- Agent→plik: dozwolone i pożądane (płaszczyzna danych). Agent nie czyta cudzych
  rozmów — czyta cudze **artefakty**.
- Recenzent jest ślepy na proces: ocenia wynik względem kontraktu, nie narrację.
  Od r3 ślepota jest techniczna: rola ma wyłącznie narzędzia odczytu (§4a).
- Model w roli = stały. Nie „awansujemy" Sonneta do decyzji architektonicznych.

## 2. Klasyfikacja przebiegu (decyzja Arbitra w fazie 0)

- **PEŁNY (9 faz)** — gdy zadanie tworzy/zmienia realne UI lub logikę: sekcja, strona,
  endpoint, integracja, refaktor przekraczający 1 plik.
- **SKRÓCONY** — content/copy, drobna korekta stylu, zmiana configu: fazy **0 → 3 → 8**,
  z bramką A obowiązkowo i B jeśli dotyka runtime. Kontrakt zastępuje 3-punktowa notatka
  w briefie. Recenzja: Arbiter sam (1 soczewka: zgodność + regresja).
- W razie wątpliwości: PEŁNY. Koszt protokołu < koszt regresji.
- **Powód PEŁNEGO bywa wymagalny.** Jeżeli zadanie zadeklarowano jako PEŁNE, a jego File Mapa
  nie potwierdza maszynowo żadnej klauzuli powyższej listy (brak roli frontendowej i brak wzorca
  otwartego), powód wyboru PEŁNEGO zapisuje się w briefie w linii `uzasadnienie_trybu:` —
  klauzula może zachodzić („logika", „integracja", zdanie domyślne), ale **stwierdzić ją może
  wyłącznie człowiek**. Pilnuje tego detektor `[P-H18]` w trybie `raport`: adresatem jest Arbiter,
  nie rola przed bramką, a wyciszeniem jest **zapisanie powodu**, nie zmiana trybu.
  Reguła klasyfikacji powyżej i zdanie „w razie wątpliwości: PEŁNY" pozostają nietknięte —
  detektor **nie orzeka o trybie ani o rozmiarze zadania**, tylko o braku zapisu (T-KLAS-1, A3/A5).

## 3. Dziewięć faz

Konwencja zapisu: **We** (wejście) → **Kto** → **Wy** (wyjście/artefakt) → **Exit**
(warunek przejścia). Artefakty lądują w płaszczyźnie danych; Arbiter po każdej fazie
aktualizuje `PHASE_STATE`.

**FAZA 0 — Specyfikacja**
We: wymaganie CEO (jedno zdanie wystarczy). Kto: Arbiter.
**Krok 0a — precedens (przed pisaniem briefu):**
```bash
scripts/memory.sh recall "<opis zadania>" --stack <stack> --limit 5
```
Wynik wchodzi do briefu jako sekcja **Precedens**: lista referencji (kontrakt +
delivery) z jednym zdaniem, dlaczego dany precedens jest podobny, i jednym, czym
bieżące zadanie się różni. Architekt **otwiera kontrakt** w fazie 1 — `recall`
zwraca ścieżki i metryki, nigdy fragmenty kodu. Precedens podany jako gotowy
fragment produkuje kod kultowy: powielany, bo kiedyś zadziałał, bez rozumienia
dlaczego. „Brak precedensu" to informacja wpisywana do briefu, nie porażka.
Wy: `docs/briefs/<TASK>.md` — brief per rola + **Kryteria Odbioru (DoD)**: mierzalne,
sprawdzalne przez bramki i Recenzenta + **polityka zastępników** (jakie dane syntetyczne
wolno użyć tam, gdzie realnych brak) + klasyfikacja PEŁNY/SKRÓCONY + **Precedens**.
Exit: brief kompletny; DoD zdefiniowane Z GÓRY — to one rozstrzygną odbiór, nie człowiek.

> **`recall` nie jest bramką i nie ma prawa zatrzymać fazy 0.** Należy do
> płaszczyzny osądu (§0): podpowiada Arbitrowi i Architektowi, nie rozstrzyga.
> Kod wyjścia **69 = tryb zdegradowany, nie błąd** — pamięć zeszła na
> wyszukiwanie pełnotekstowe (brak embeddera) albo na `grep` po `docs/`
> (brak bazy) i mówi o tym wprost w wyniku. Faza 0 idzie dalej w każdym z tych
> stanów; brak pamięci nigdy nie blokuje protokołu. Gdyby `gate.sh` kiedykolwiek
> zapytał pamięć o cokolwiek — to znak, że płaszczyzny się zlały.
>
> Zanim pierwszy raz oprzesz projekt na precedensie: `scripts/memory.sh doctor --korpus`.
> Skoro żadna bramka korpusu nie sprawdza, jego skrzywienie nie ma jak się ujawnić —
> `recall` zawsze coś zwróci i zawsze zabrzmi wiarygodnie (szczegóły w `hait-pamiec`).

**FAZA 1 — Architektura**
We: brief. Kto: Architekt.
Wy: ADR (decyzje + odrzucone alternatywy), `docs/contracts/<TASK>.kontrakt.md`
(typy, endpointy, nazwy komponentów, propsy), **File Map** (kto dotyka których plików —
zbiory rozłączne). Exit: `scripts/preflight.sh --task <TASK>` = 0 FAIL (detektory znają
przeszłość projektu, zanim powstanie kod).

**FAZA 2 — Przegląd kontraktu** ★ (kontrola przesunięta w lewo)
We: kontrakt + ADR. Kto: Recenzent (ślepy na brief-rozmowy; czyta artefakty) + Architekt.
Wy: werdykt APPROVED / uwagi→korekta kontraktu. Konsensus = osąd, tu jest jego miejsce.
**Werdykt trafia do pliku**: `docs/reviews/<TASK>.faza2-runda<N>.md` (§7a) — jedna runda,
jeden plik. Osąd bez zapisu nie istnieje w płaszczyźnie danych.
Exit: APPROVED. Błąd projektowy złapany tutaj kosztuje rozmowę, w fazie 6 — przepisanie.

**FAZA 3 — Implementacja (równoległa)**
We: kontrakt + File Map. Kto: Impl-BE ∥ Impl-FE (osobne subagenty, osobne konteksty).
Wy: kod wyłącznie w swoich plikach + diff per implementator.
Exit: **bramka A per implementator**: `gate.sh A <TASK>` (build + lint + tsc + detektory).

**FAZA 4 — Integracja (deterministyczna)**
We: diffy obu implementatorów. Kto: maszyna; Arbiter tylko rozstrzyga konflikty,
których skrypt nie umie. **LLM nie scala kodu.**
Wy: gałąź zintegrowana. Exit: build całości + grep zgodności z kontraktem
(nazwy/endpointy z `kontrakt.md` istnieją w kodzie: `grep -f` listy symboli).

**FAZA 5 — Testy**
We: kod zintegrowany. Kto: Tester (pisze testy — deliverable, nie rytuał).
Wy: testy + raport. Exit: **bramka B**: `gate.sh B <TASK> --routes "…" [--api "…"]`
(serwer wstaje, trasy 200, a11y-smoke: dokładnie 1×`<h1>`, `lang`; API: invalid→422,
honeypot→ciche 200) **plus** zielone testy Testera. Werdyktem jest wynik skryptu,
nie raport agenta.

**FAZA 6 — Code review (ślepy) + bramka C**
We: diff + kontrakt + screenshoty. Kto: Recenzent.
Wy: APPROVE / lista poprawek (5 soczewek: poprawność, kontrakt, typy, a11y+RWD,
bezpieczeństwo). **Werdykt trafia do pliku**: `docs/reviews/<TASK>.faza6-przeglad.md`,
a werdykt po poprawkach do `<TASK>.faza6-werdykt.md` (§7a).
Exit: `gate.sh C <TASK> --routes "…"` dostarcza screenshoty
390×844 + 1440×900 (brak playwrighta ⇒ SKIPPED exit 2 = ocena ręczna, nie cichy PASS)
oraz APPROVE Recenzenta.

**FAZA 7 — Poprawki (pętla z budżetem)**
We: FAIL bramki lub lista Recenzenta. Kto: Arbiter kieruje do właściwej roli.
Reguły twarde: FAIL bramki **automatycznie** tworzy stub RCA; **druga próba nie ruszy**
bez wypełnionego `- detect:` w RCA (gate.sh to egzekwuje, exit 75); po naprawie
`scripts/add-pitfall.sh docs/rca/<plik>.md` dopisuje detektor do rejestru.
Exit: bramka, która poległa — PASS. **3. FAIL = ESKALACJA** do człowieka; licznik
zeruje się przy PASS.

**FAZA 8 — Odbiór (automatyczny)**
We: wszystkie bramki PASS + APPROVE. Kto: konsensus końcowy zespołu — bez człowieka.
Wy: `DELIVERY.md` (z `docs/DELIVERY_TEMPLATE.md`) — manifest 100% zakresu, DoD
odhaczone, jawna lista zastępników + `gate.sh metrics` + postmortem.
**Krok 8a — zapis precedensu** (domyka pętlę otwartą w kroku 0a):
```bash
scripts/memory.sh commit <TASK> [--antywzorzec "powód"]
```
Kapsuła powstaje z `DELIVERY.md` i telemetrii — metryki nie są wymyślane, tylko
czytane z `events.jsonl`, tego samego pliku, z którego liczy `gate.sh metrics`.
Warunek zapisu to istnienie `DELIVERY` — pamięć przyjmuje wyłącznie zadania
DOSTARCZONE, więc filtrem jakości korpusu jest predykat prawdy protokołu, a nie
nowe kryterium. `--antywzorzec` zapisuje zadanie jako przestrogę: pojawia się
w `recall` z jawnym ostrzeżeniem i obniżoną wagą. **Nieudane zadania są
cenniejszym precedensem niż udane** — usuwanie ich z pamięci to najczęstszy
sposób, w jaki pamięć organizacyjna przestaje działać.
Exit: DoD spełnione = **DELIVERED natychmiast**. Życzenia zmian po dostarczeniu
wchodzą pętlą modyfikacji (§5a) i nie wstrzymują odbioru. Nieudany `commit`
(np. brak bazy) **nie cofa DELIVERED** — kapsułę odtworzy `memory.sh reindex`,
bo baza jest indeksem, nie źródłem.

## 4. Bramki — deterministyczny kręgosłup

| Bramka | Komenda | Sprawdza | Exit |
|---|---|---|---|
| A (statyczna) | `scripts/gate.sh A <TASK>` | build, lint, tsc (gdy tsconfig), **wszystkie detektory rejestru** | 0 PASS / 1 FAIL / 75 blokada-RCA |
| B (runtime) | `scripts/gate.sh B <TASK> --routes "/,/x" [--api "/api/y"]` | start (kill po PID — nigdy `pkill -f`), trasy 200, a11y-smoke, kontrakt API 422/honeypot | jw. |
| C (wizualna) | `scripts/gate.sh C <TASK> --routes "/"` | screenshoty mobile+desktop dla ślepego Recenzenta | 0/1/75 oraz **2 = SKIPPED** |
| task | `scripts/gate.sh task <TASK> …` | A, potem B | jw. |
| metrics | `scripts/gate.sh metrics` | `events.jsonl` → `protocol-metrics.json` | 0 |

Konfiguracja pod inne stacki/testy przez env: `BUILD_CMD LINT_CMD TSC_CMD START_CMD
PORT BASE_URL GATE_B_WAIT`.

## 4a. Powłoka infrastrukturalna (r3) — trzecia warstwa egzekwowania

Warstwy egzekwowania protokołu: (1) obietnica modelu → (2) skrypt wywoływany
w przebiegu → (3) **mechanizm platformy, którego model nie może pominąć**.
Powłoka = warstwa 3, zdefiniowana w `.claude/` (commitowana do repo):

| Mechanizm | Plik | Egzekwuje |
|---|---|---|
| hook SessionStart | `scripts/hooks/session-start.sh` | auto-iniekcja PHASE_STATE do kontekstu (start/wznowienie/po kompakcji) — R3 zamknięte |
| hook PreToolUse | `scripts/hooks/filemap-guard.sh` + `.py` | File Map fizycznie: edycja poza przydziałem roli = blokada exit 2 ZANIM narzędzie zadziała |
| hook PostToolUse | `scripts/hooks/post-edit.sh` | znacznik `dirty` + preflight natychmiast po edycji; FAIL wraca do agenta od razu |
| hook Stop | `scripts/hooks/stop-gate.sh` | tura NIE MOŻE się zakończyć przy `dirty` bez PASS bramki (bezpiecznik: stop_hook_active) |
| hook PreCompact | `scripts/hooks/pre-compact.sh` | zdarzenie `compact` w telemetrii + przypomnienie o stanie |
| permissions: deny | `.claude/settings.json` | zakaz pkill, ręcznej edycji rejestru pułapek, odczytu .env — bliźniak detektorów klasy H |
| role jako pliki | `.claude/agents/*.md` | tools + model per rola (Opus 4.8: architekt, recenzent; Sonnet 5: reszta); Recenzent read-only; implementatorzy `isolation: worktree` |

Reguły powłoki:
1. **Znacznik dirty**: każda edycja stawia `.aios/dirty`; zdejmuje go wyłącznie
   PASS bramki (`gate.sh`). Stop-hook czyta znacznik — „done" bez bramki nie istnieje.
2. **File Map** to plik `docs/contracts/<TASK>.filemap` (linie `rola: wzorzec`,
   zbiory rozłączne), tworzony przez Architekta w fazie 1; wskaźnik aktywnego
   zadania: `.aios/active_task`. Świadome fail-open: brak mapy / brak zadania /
   sesja główna (Arbiter) ⇒ strażnik przepuszcza — pilnuje implementatorów po fazie 1.
3. **Faza 3∥ przez worktree**: `isolation: worktree` we frontmatterze implementatorów —
   platforma prowizjonuje świeży worktree per wywołanie i sprząta po nim;
   faza 4 to dosłownie deterministyczny `git merge`.
4. Powłoka wymaga aktualnego Claude Code; nazwy pól/zdarzeń weryfikuj przy
   aktualizacjach narzędzia w bieżącej dokumentacji hooks/subagents. Skrypty
   bramek działają też BEZ powłoki (warstwa 2 jest samowystarczalna i przenośna);
   powłoka je opina, niczego nie zastępuje.

## 5. Pętla uczenia FAIL→detektor (serce v1.0-S)

1. Bramka FAIL → skrypt zapisuje zdarzenie i **tworzy stub RCA** z szablonu
   (prefill: task, bramka, iteracja, powód).
2. Protokół blokuje retry, dopóki RCA nie ma wypełnionego `- detect:`
   (jedna linia bash; tryby: `empty` = trafienia⇒FAIL, `obecny` = brak⇒FAIL,
   `raport` = trafienia⇒WARN).
3. `add-pitfall.sh <RCA>` waliduje pola, nadaje ID `[P-K##]`, dopisuje wpis
   do `docs/STACK_PITFALLS.md` we właściwej sekcji i weryfikuje detektor.
4. `preflight.sh` i bramka A **wykonują** wszystkie `detect:` przy każdym przebiegu.
5. Ten sam błąd następnym razem ginie w fazie 1, zanim powstanie kod.

„Automatycznie" znaczy: to skryptowany, wymuszony krok fazy 7 — nie akt pamięci
modelu. Rejestr jest przenośny między projektami na tym samym stacku.

**Ruch powrotny: `retire-pitfall.sh`.** Pętla przez pięć zadań umiała tylko dopisywać,
więc wpis z za wąskim warunkiem obchodziliśmy dopisaniem drugiego obok (`P-H09` obok
`P-H07`, `P-H10` obok `P-H06`). Wycofanie **nie jest usunięciem**: wpis zostaje w pliku
w całości, dostaje pole `- wycofany: <data> — <powód>`, a preflight przestaje go wykonywać
i liczy w kolumnie `WYCOFANYCH`. Lekcja zostaje, kontrola znika — usunięcie zabrałoby jedno
i drugie. Powód obowiązkowy, `--zastapiony-przez` musi wskazywać wpis istniejący, operacja
odwracalna przez `--przywroc`. Reguły: `docs/SPECYFIKACJA.md §I.6.2`.

**Trzy powody, dla których detektor nie został wykonany, i wszystkie trzy są widoczne:**
`POMINIĘTY` (pusty zakres w tym drzewie), `WYCOFANY` (decyzja zapisana w rejestrze),
oraz ostrzeżenie, gdy wykonanych jest **zero** — bo rejestr złożony wyłącznie z pominiętych
i wycofanych daje zero FAIL i wygląda jak siatka, która wszystko sprawdziła.

## 5a. Model dostarczenia: Całość → Modyfikacje

Protokół dostarcza **całość, natychmiast, bez bramki ludzkiej**. Reguły:
1. Człowiek ma dokładnie dwa punkty styku: wydaje wymaganie (faza 0) i — wyłącznie
   jeśli chce — zgłasza modyfikacje po dostarczeniu. W szczęśliwej ścieżce między
   tymi punktami nie jest aktywowany ani razu.
2. Odbiór rozstrzygają Kryteria Odbioru (DoD) z fazy 0 + bramki + konsensus —
   nie oczekiwanie na klik. Spełnione ⇒ DELIVERED.
3. Czego AI dostarczyć nie może (realne zdjęcia, NIP, dostępy), dostarcza jako
   **zastępnik** zgodny z polityką z fazy 0, jawnie wylistowany w `DELIVERY.md`.
   Manifest to informacja, nie prośba o zgodę.
4. **Modyfikacja = pełnoprawne wejście protokołu**: Arbiter klasyfikuje ją jako
   zadanie delta (domyślnie SKRÓCONY; PEŁNY, gdy dotyka architektury) i przepuszcza
   przez te same bramki i ten sam rejestr. Cykl: buduj → dostarcz → modyfikuj → dostarcz.
5. Jedyny wyjątek aktywujący człowieka w trakcie: eskalacja po 3. FAIL — to obsługa
   awarii pętli, nie udział w procesie.

Nota migracyjna: dawna konwencja [88]/[12] („88Done") jest zniesiona; stare hasła
mapują się na ten model — „88Done" czytaj jako DELIVERED, dawną listę [12] jako
sekcję zastępników w `DELIVERY.md`.

## 6. PHASE_STATE — wznawialność w abonamencie

- Start KAŻDEJ sesji: Arbiter czyta `docs/PHASE_STATE_<TASK>.md`
  (tworzony z `docs/PHASE_STATE.template.md` w fazie 0) i wykonuje `next_action`.
- Po każdej zmianie fazy / wyniku bramki / na koniec sesji: Arbiter aktualizuje plik
  (faza_aktywna, statusy, liczniki iteracji, artefakty, next_action, notatka).
- Nowa sesja = nowy kontekst, ale nie nowa pamięć: stan żyje w pliku, nie w oknie.
  Limit sesji abonamentu przestaje być limitem projektu.

## 7. Telemetria

- `telemetry/events.jsonl` — surowe zdarzenia (preflight, gate, eskalacja, pitfall);
  dopisują skrypty, nikt nie edytuje ręcznie.
- `telemetry/protocol-metrics.json` — agregat po `gate.sh metrics`; czyta go
  postmortem oraz wizualizacja `ArbiterFazowyV1.tsx` (kokpit LIVE zamiast atrapy).
- Postmortem (obowiązkowy po fazie 8): szablon w `docs/POSTMORTEM_TEMPLATE.md` —
  wnioski + rollup metryk + detektory dodane + odsyłacz do `DELIVERY.md`.

## 7a. Trwałość osądu — werdykty recenzji jako plik

Zasada czterech płaszczyzn mówi, że **treść pracy żyje w plikach**, a Arbiter przekazuje
referencje. Do wersji T-ABC włącznie miała dziurę: role zwracały werdykty **tekstem do
Arbitra, nie plikiem**. Osąd — najdroższa rzecz, jaką produkuje faza 2 i faza 6 — nie trafiał
do płaszczyzny danych i ginął razem z sesją. W przebiegu referencyjnym przepadło w ten sposób
27 pozycji z przeglądu kontraktu i 11 z przeglądu kodu.

Reguła twarda: **każdy werdykt fazy 2 i fazy 6 kończy się plikiem w `docs/reviews/`.**
Konwencja nazw i wymagany nagłówek proweniencji: `docs/reviews/README.md`.

Kto zapisuje: **Arbiter, dosłownie.** Recenzent ma wyłącznie narzędzia odczytu — jego ślepota
jest techniczna i to samo ograniczenie uniemożliwia mu zapis własnego werdyktu. Świadomy
kompromis: read-only gwarantuje, że recenzent nie naprawi tego, co recenzuje. Konsekwencja:
Arbiter jest pośrednikiem między osądem a jego zapisem, więc obowiązują dwa zabezpieczenia:

1. Werdykt przepisujemy **dosłownie** — treść, wagi pozycji, odwołania `plik:linia`
   i uzasadnienia zostają nietknięte. Skracać wolno wyłącznie powtórzenia.
2. **Rozstrzygnięcia Arbitra idą do osobnego pliku** (`<TASK>.fazaN-rozstrzygniecia-arbitra.md`),
   nigdy do pliku werdyktu. Osąd i sterowanie to dwie płaszczyzny i nie mieszają się
   w jednym dokumencie.

Warunek techniczny: `scripts/integrate.sh` musi wyłączać `docs/**` i pliki prozy ze skanu
symboli — inaczej werdykt, gęsty od nazw, maskuje kontrolę fazy 4 na stałe (detektor `[P-H11]`,
który mierzy **wynik** wyłączenia; jego poprzednicy `[P-H06]` i `[P-H10]` sprawdzali obecność
nazwy zmiennej i były zielone, gdy warstwa nie działała — wycofani 13.08.2026).

Egzekwowanie: detektor `[P-H07]` w trybie `raport` — WARN dla zadania z kontraktem, ale bez
werdyktu fazy 2. Świadomie WARN, nie FAIL: między fazą 1 a 2 taki stan jest normalny
i blokowanie edycji byłoby fałszywym pozytywem.

## 8. Hierarchia i współpraca

`prompt bieżącego zadania` > `aios-fazowy (ten plik)` > `ui-ux-pro-max` i inne
skille domenowe. Konflikt = wygrywa wyższy poziom; Arbiter odnotowuje konflikt
w PHASE_STATE (notatka), żeby postmortem mógł go ocenić.

## 9. Szybki start

```bash
# 1) wgraj pakiet do repo (docs/, scripts/, telemetry/), nadaj prawa:
chmod +x scripts/*.sh
# 2) sanity-check detektorów na aktualnym kodzie:
scripts/preflight.sh --task T-0
# 3) pierwsze zadanie — Arbiter: faza 0 (brief + PHASE_STATE z szablonu), potem fazy 1→8;
#    bramki wg tabeli w §4; po każdym FAIL działa §5.
```

## 10. Struktura pakietu

```
SKILL.md                        ← ten plik (rdzeń protokołu)
docs/STACK_PITFALLS.md          ← rejestr pułapek z wykonywalnymi detect: (12 seedów)
docs/reviews/                   ← werdykty faz 2 i 6 (§7a) + README z konwencją i proweniencją
docs/RCA_TEMPLATE.md            ← szablon diagnozy (wymuszany przed 2. iteracją)
docs/PHASE_STATE.template.md    ← szablon trwałego stanu (wznawialność sesji)
docs/POSTMORTEM_TEMPLATE.md     ← szablon postmortemu z rollupem telemetrii
docs/DELIVERY_TEMPLATE.md       ← manifest dostarczenia (odbiór automatyczny fazy 8)
docs/WARSZTAT_ANALITYCZNY.md    ← metoda + delty stabilizacji + dowody z przebiegów
scripts/preflight.sh            ← krok 0: wykonuje detektory rejestru
scripts/hooks/                  ← powłoka r3: session-start, filemap-guard(+.py), post-edit, stop-gate, pre-compact
.claude/settings.json           ← hooki + permissions:deny (powłoka, commitowana do repo)
.claude/agents/*.md             ← 5 ról: tools + model + (implementatorzy) isolation: worktree
scripts/gate.sh                 ← bramki A/B/C/task + metrics (budżet iteracji, RCA, eskalacja)
scripts/add-pitfall.sh          ← RCA → nowy detektor w rejestrze
scripts/retire-pitfall.sh       ← wycofanie wpisu: przestaje być wykonywany, treść zostaje (odwracalne)
scripts/memory.sh               ← pamięć zadań: recall (faza 0) · commit (faza 8) · reindex · doctor [--korpus]
db/001_schema.sql               ← schemat pamięci: pgvector ≥ 0.8.2 (próg CVE), konfiguracja TS `polski`
docker-compose.yml              ← Postgres + embedder (profil `embed`); bez embeddera tryb zdegradowany
telemetry/                      ← events.jsonl + protocol-metrics.json (generowane)
ArbiterFazowyV1.tsx             ← kokpit: 9 faz, gwiazda, pętla uczenia, metryki LIVE/DEMO
```

## Quick reference

```
precedens:   scripts/memory.sh recall "<opis>" --stack <stack> --limit 5   (faza 0, krok 0a)
             kod 69 = tryb zdegradowany, NIE błąd · nigdy nie blokuje fazy
zapis:       scripts/memory.sh commit T-42 [--antywzorzec "…"]            (faza 8, krok 8a)
korpus:      scripts/memory.sh doctor --korpus   (po reindeksie i przy 1. zasileniu)
preflight:   scripts/preflight.sh --task T-42 [--kategoria E] [--quiet]
bramka A:    scripts/gate.sh A T-42
bramka B:    scripts/gate.sh B T-42 --routes "/,/kontakt" --api "/api/kontakt"
bramka C:    scripts/gate.sh C T-42 --routes "/"
A+B:         scripts/gate.sh task T-42 --routes "/"
metryki:     scripts/gate.sh metrics
pętla:       FAIL → docs/rca/RCA_* (uzupełnij detect:) → scripts/add-pitfall.sh <RCA>
wycofanie:   scripts/retire-pitfall.sh <ID> --powod "…" [--zastapiony-przez <ID>] · --przywroc <ID> · --lista
odbiór:      DoD spełnione ⇒ DELIVERED + DELIVERY.md · modyfikacja ⇒ zadanie delta
eskalacja:   3. FAIL tej samej bramki = stop, decyzja człowieka (jedyny wyjątek)
stan:        docs/PHASE_STATE_<TASK>.md — od r3 wstrzykiwany automatycznie (SessionStart)
werdykty:    docs/reviews/<TASK>.faza2-runda<N>.md · <TASK>.faza6-{przeglad,werdykt}.md (§7a)
powłoka:     edycja ⇒ dirty · Stop zablokowany do PASS bramki · File Map = fizyka (PreToolUse)
```
