---
name: hait-setup
description: >-
  Konfiguracja hAit w repozytorium przy pierwszym użyciu — wykrywa stack, komendy walidacji i
  tracker, po czym zapisuje .hait/hait.config.json oraz brakujące dokumenty projektowe
  (AGENTS.md, PROTOKOL.md, STACK_PITFALLS.md). Używaj ZAWSZE, gdy inny skill hAit nie znajduje
  konfiguracji, a także na żądanie: "skonfiguruj hAit", "zainstaluj protokół w tym repo",
  "hait init", "brakuje hait.config". Nie używaj do zmiany istniejącej konfiguracji — do tego
  służy ręczna edycja pliku.
---

# hait-setup — konfiguracja przy pierwszym użyciu

Skill wykonywany raz na repozytorium. Jego produktem jest **jeden plik
konfiguracji** i komplet dokumentów, których protokół wymaga, a których
w repozytorium nie ma.

## Zasada nadrzędna

**Nic nie jest zahardkodowane w skryptach ani w skillach.** Gałąź bazowa,
komendy budowania, port, ścieżki, tracker i poziomy zdolności pochodzą
z `.hait/hait.config.json`. Skill, który zna nazwę gałęzi, jest skillem
związanym z jednym repozytorium na zawsze.

**Konfiguracja jest wykrywana, nie zgadywana.** Każda wartość ma pochodzić
z pliku, który w repozytorium istnieje. Tam, gdzie wykrycie się nie uda,
skill **pyta** albo wpisuje wartość i **oznacza ją jako niepewną** — nigdy
nie wpisuje wartości pewnym tonem bez podstawy.

## Krok 0 — czy jest co robić

```bash
test -f .hait/hait.config.json && echo "konfiguracja istnieje — kończę"
```

Jeśli plik istnieje: **nie nadpisuj**. Wypisz jego zawartość, wskaż pola,
które wyglądają na nieaktualne (np. komenda budowania, której nie ma
w `package.json`), i zakończ. Lokalny plik wygrywa.

## Krok 1 — wykrycie stacku

Kolejność sprawdzania i co z niej wynika:

| Sygnał w repozytorium | `build` | `lint` | `typecheck` | `start` |
|---|---|---|---|---|
| `package.json` ze skryptem `build` | `npm run build` | `npm run lint` (jeśli jest) | `npx tsc --noEmit` (jeśli `tsconfig.json`) | `npm run start` |
| `Cargo.toml` | `cargo build --release` | `cargo clippy -- -D warnings` | — | `cargo run` |
| `pyproject.toml` | — | `ruff check` | `mypy .` (jeśli w zależnościach) | — |
| `go.mod` | `go build ./...` | `go vet ./...` | — | — |

Wykrycie mieszane (np. Rust + Python) jest normalne — wpisz obie komendy
w `validation.commands` jako listę. Kolejność ma znaczenie: najtańsza
komenda pierwsza, żeby FAIL przychodził szybko.

**Nie wymyślaj komendy, której nie ma.** Brak lintera to `null` i wpis
w `niepewne`, nie `eslint .` na wszelki wypadek.

## Krok 2 — gałąź bazowa i tracker

Gałąź bazową odczytaj z repozytorium, nie z założenia:

```bash
git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'
```

Brak wyniku ⇒ zapytaj. `main` jest domyślne w statystyce, nie w tym repozytorium.

Tracker: sprawdź, czy istnieje `.hait/trackers/<nazwa>.md`. Jeśli żaden nie
pasuje, wpisz `tracker: null` i odnotuj, że operacje trackera są niedostępne —
protokół działa bez trackera, po prostu bez integracji ze zgłoszeniami.

## Krok 3 — dokumenty, które generujemy tylko gdy ich brak

| Plik | Treść | Skąd bierzemy treść |
|---|---|---|
| `AGENTS.md` | tablica routingu zadań po katalogach | ze skanu układu repozytorium |
| `docs/PROTOKOL.md` | opis przepływu faz i bramek **dla ludzi** | z charta, po polsku, bez żargonu |
| `docs/STACK_PITFALLS.md` | rejestr pułapek z pustymi sekcjami kategorii | z szablonu |
| `docs/rca/` | katalog na diagnozy | pusty |

**`AGENTS.md` buduj ze skanu, nie z szablonu.** Tablica routingu ma wskazywać
katalogi, które w tym repozytorium naprawdę istnieją. Tablica wymieniająca
`src/modules/`, którego nie ma, jest gorsza niż jej brak — uczy model, że
dokumentacja kłamie.

**`docs/PROTOKOL.md` piszemy dla człowieka.** Proces zakodowany wyłącznie
w skillach jest procesem, którego nowy członek zespołu nie ma jak poznać.

## Krok 4 — zapis i weryfikacja

Zapisz `.hait/hait.config.json`, a następnie **sprawdź własną robotę**:

```bash
hait doctor
hait status
```

Jeżeli `doctor` zgłasza brak bramek albo powłoki, to nie jest błąd tego
skilla — to informacja, że pakiety `aios-fazowy` (warstwa 2 i 3) i
`aios-pamiec` (warstwa 5) nie są jeszcze zamontowane. Wypisz, czego brakuje,
i podaj komendy montażu. **Nie montuj ich sam** — to osobna, jawna decyzja.

## Czego ten skill nie robi

- **nie instaluje zależności** — żadnego `npm install`, `cargo add`, `pip install`;
- **nie modyfikuje istniejących plików** — wyłącznie tworzy brakujące;
- **nie dotyka historii repozytorium** — bez commitów, bez gałęzi, bez tagów;
- **nie czyta sekretów** — `.env` jest poza zakresem i jest na liście zakazów;
- **nie zgaduje wartości, których nie wykrył** — pyta albo oznacza jako niepewne.

## Wyjście

Raport w trzech sekcjach — i tylko tyle:

```
WYKRYTO        stack, komendy, gałąź bazowa, tracker  (z podaniem, skąd)
UTWORZONO      lista plików
NIEPEWNE       pola wymagające decyzji człowieka — albo "brak"
```

Jeżeli sekcja `NIEPEWNE` jest pusta, napisz „brak" i weź odpowiedzialność
za konfigurację. Jeżeli nie jest — nie wypełniaj jej grzecznościowo.
