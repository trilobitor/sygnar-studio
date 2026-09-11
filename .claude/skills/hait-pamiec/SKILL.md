---
name: hait-pamiec
description: >
  Pamięć organizacyjna hAit — indeks zrealizowanych zadań, z którego Architekt
  i Arbiter wyciągają precedens przed projektowaniem. Używaj przy hasłach
  „precedens", „czy już to robiliśmy", „pamięć", „recall", „poprzednie zadanie",
  „lekcja z poprzedniego projektu", a obowiązkowo w fazie 0 (odczyt) i fazie 8
  (zapis) protokołu fazowego.
---

# hait-pamiec — pamięć organizacyjna

## Czym jest, a czym nie

**Jest:** indeksem zrealizowanych zadań. Jedna kapsuła na ukończone zadanie:
streszczenie briefu, DoD, referencje do plików, metryki z telemetrii.

**Nie jest:** pamięcią konwersacyjną, bazą wiedzy o kodzie ani źródłem prawdy.
Nie przechowuje treści pracy — wyłącznie ścieżki do niej i liczby opisujące,
jak poszła. Źródłem prawdy jest repozytorium; baza jest indeksem i wolno ją
w całości odbudować (`scripts/memory.sh reindex`).

## Zakaz, który definiuje tę warstwę

**Żadna bramka nie odpytuje pamięci.** Pamięć należy do płaszczyzny osądu;
bramka rozstrzyga fakty. Gdyby `gate.sh` kiedykolwiek zapytał pamięć,
werdykt faktu zacząłby zależeć od historii — a to jest dokładnie ten rodzaj
niedeterminizmu, przed którym broni cała warstwa 2. Naruszenie łapie detektor
w rejestrze pułapek.

## Druga zasada: referencje, nie treść

`recall` zwraca **ścieżki i metryki**, nigdy fragmenty kodu. Architekt musi
świadomie otworzyć plik precedensu. Cel jest wprost przeciwny do wygody:
precedens ma zostać **przeczytany i zrozumiany**, a nie skopiowany. Pamięć,
która podaje gotowy fragment, produkuje kod kultowy — powielany, bo kiedyś
zadziałał, bez rozumienia dlaczego.

## Trzy poziomy degradacji

| Poziom | Warunek | Zachowanie | Kod |
|---|---|---|---|
| pełny | Postgres + embedder | wektor × filtr SQL × waga jakości i wieku | 0 |
| zdegradowany | Postgres bez embeddera | wyszukiwanie pełnotekstowe (FTS) | 69 |
| awaryjny | brak Postgresa | `grep` po `docs/` w repozytorium | 69 |

**Pamięć nigdy nie blokuje protokołu.** Poziom zdegradowany zgłasza się jawnie
w wyniku — użytkownik ma wiedzieć, że dostał gorszą odpowiedź, a nie
domyślać się tego z jej jakości.

## Dwa profile embeddera

Wybiera pole `pamiec.embedder.aktywny` w `.hait/hait.config.json`.

| profil | backend | model | wymiar | kontekst | gdzie |
|---|---|---|---|---|---|
| `ollama-docker` **(domyślny)** | ollama | EmbeddingGemma-300M | 768 | 2048 | kontener, przenośny |
| `tei-metal` | TEI | BAAI/bge-m3 | 1024 | 8192 | **natywny Metal, poza Dockerem** |

`tei-metal` istnieje poza `docker-compose.yml` świadomie: kontener nie ma dostępu
do GPU Apple, więc skonteneryzowanie tego profilu zabrałoby cały jego sens.
hAit go **nie startuje i nie nadzoruje** — sprawdza tylko, czy odpowiada.
Uruchomienie ręczne: `text-embeddings-router --model-id BAAI/bge-m3 --port 8081`.

> **Pułapka przełączania: profile mają różne wymiary wektora**, a wymiar jest
> wpisany w kolumnę `embedding vector(N)` i w indeks HNSW. Sama zmiana pola
> `aktywny` daje bazę, która **odrzuci każdy zapis**. Pełna sekwencja:
> ```bash
> psql … -f db/002_migrate_dim.sql -v dim=<nowy>   # kasuje wektory, przebudowuje indeks
> scripts/memory.sh reindex                        # odtwarza wektory z repo
> ```
> Rzutowanie starych wektorów na nowy wymiar **nie istnieje i istnieć nie może**:
> współrzędne z modelu A nie znaczą nic w przestrzeni modelu B. „Przycięcie"
> albo „dopełnienie zerami" dałoby wektory składniowo poprawne i semantycznie
> bezwartościowe — czyli `recall` zwracający szum, który wygląda wiarygodnie.
> To najgorszy możliwy stan tej warstwy, gorszy niż jej brak.
>
> `memory.sh doctor` porównuje **trzy** wymiary — zadeklarowany w profilu,
> faktycznie zwracany przez embedder i ten w kolumnie — i oblewa przy każdym
> rozjeździe, podając gotową komendę migracji.

## Użycie w protokole

**Faza 0 — przed projektowaniem:**
```bash
scripts/memory.sh recall "<opis zadania>" --stack <stack> --limit 5
```
Wynik wpisuje się do briefu jako lista referencji z jednym zdaniem, dlaczego
dany precedens jest podobny. Jeśli żaden nie pasuje — zapisuje się „brak
precedensu", co jest informacją, nie porażką.

**Faza 8 — po odbiorze:**
```bash
scripts/memory.sh commit <TASK> [--antywzorzec "powód"]
```
Kapsuła powstaje z `DELIVERY.md` i telemetrii. Flaga `--antywzorzec` zapisuje
zadanie jako przestrogę: kapsuła oznaczona w ten sposób pojawia się w `recall`
z jawnym ostrzeżeniem. **Nieudane zadania są cenniejszym precedensem niż udane**
i usuwanie ich z pamięci jest najczęstszym sposobem, w jaki pamięć organizacyjna
przestaje działać.

## Higiena

- `scripts/memory.sh doctor` — wersja pgvector (próg bezpieczeństwa), embedder,
  schemat. Nigdy nie kończy się błędem: brak infrastruktury to stan do
  zaraportowania.
- `scripts/memory.sh stats` — pokrycie: ile zadań w repozytorium ma kapsułę.
  Pokrycie poniżej ~80% oznacza, że `recall` kłamie przez pominięcie.
- `scripts/memory.sh reindex` — odbudowa z repozytorium. Wolno robić zawsze;
  baza jest indeksem, nie źródłem.
- `scripts/memory.sh doctor --korpus` — zgodność bazy z repozytorium
  i telemetrią: sieroty, luki, szablony, złe daty, doklejone detektory,
  pusty stack, brakujące wektory. **Uruchamiaj po każdym `reindex`
  i przy pierwszym zasileniu.**

  Powód osobnej komendy wynika wprost z zasady „pamięć nie jest bramką".
  Skoro nic nie sprawdza korpusu automatycznie, jego skrzywienie nie ma jak
  się ujawnić: `recall` zawsze coś zwróci i zawsze będzie brzmiał wiarygodnie.
  Pierwsze zasilenie tej bazy pięcioma zadaniami zawierało cztery takie wady
  naraz — m.in. zadanie bazowe zaciągnęło detektory swoich delt (dopasowanie
  identyfikatora podciągiem: `T-ABC` ⊂ `T-ABC-3`) i pokazywało 11 zamiast 5,
  a szablon `DELIVERY_TEMPLATE.md` siedział w korpusie jako precedens.
  Żadnej z nich nie było widać po wyniku `recall`.

## Warunek falsyfikacji

Ta warstwa jest błędna, jeśli po ~50 kapsułach `recall` nadal zwraca precedensy,
których Architekt nie otwiera. Wtedy problemem nie jest wyszukiwanie, tylko
granulacja kapsuły — zadanie jest zbyt dużą jednostką, żeby być precedensem,
i indeksować trzeba decyzje (ADR), nie zadania.
