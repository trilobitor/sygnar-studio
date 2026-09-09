# Sygnar Studio — instrukcje dla Claude Code

Pełna specyfikacja: `SPEC.md`. Ten plik to zasady pracy, nie opis produktu.
W razie sprzeczności obowiązuje `SPEC.md`.

## Zanim cokolwiek napiszesz

Przeczytaj `SPEC.md` w całości. Aplikacja spina cztery zewnętrzne narzędzia
o zupełnie różnych mechanizmach — kod pisany bez tego kontekstu będzie
strukturalnie zły, nawet jeśli się skompiluje.

## Język

- **Po polsku:** rozmowa, dokumentacja, komentarze w kodzie, opisy commitów,
  wszystkie teksty widoczne w interfejsie
- **Po angielsku:** identyfikatory w kodzie — zmienne, funkcje, typy, pliki,
  tabele, kolumny. Bez wyjątków, bez polskich znaków w identyfikatorach.

## Stack

Next.js App Router · React · TypeScript `strict` · Tailwind · shadcn/ui ·
SQLite przez Drizzle · Zod · Vitest · Playwright

**Nie proponuj technologii spoza tej listy bez pytania.** Dotyczy to również
bibliotek pomocniczych — zanim dodasz zależność, zapytaj.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`
- `any` zakazane. Nie znasz typu → `unknown` i zawężenie
- Każde `as` wymaga komentarza wyjaśniającego, dlaczego kompilator się myli
- `@ts-ignore` zakazane; `@ts-expect-error` tylko z komentarzem i wpisem
  w `dziennik/DECYZJE.md`
- Typy przez `z.infer`, nie ręcznie dublowane interfejsy

## Nazewnictwo

- Komponenty: `PascalCase.tsx` · pozostałe pliki i katalogi: `kebab-case`
- Zmienne i funkcje: `camelCase` · typy: `PascalCase` bez prefiksu `I`
- Stałe globalne: `SCREAMING_SNAKE_CASE`
- Tabele: `snake_case`, liczba mnoga · klucze obce: `<tabela_pojedyncza>_id`

## Commity

Conventional Commits, opis po polsku. Jeden commit = jedna logiczna zmiana.

```
feat(kolejka): anulowanie zadania przez AbortController
fix(comfy): obsługa rozłączenia websocketu w trakcie generowania
docs(spec): opis mapowania kodów błędów
```

## Reguły twarde

**Warstwa serwisów jest czysta.** `server/services/` nie importuje niczego
z `next/*`. Ma dać się przetestować bez uruchamiania frameworka.

**Każda granica ma schemat Zod.** Formularz, body requestu, query string,
odpowiedź z ComfyUI, wynik warstwy promptowej, zawartość wgranego pliku.
Ten sam schemat po stronie klienta i serwera.

**Zakaz `console.log` w kodzie oddawanym.** Logowanie przez `logger`,
zawsze z kontekstem: kto, co, jakie ID.

**Zakaz połykania błędów.** Błąd jest obsłużony albo jawnie propagowany
w górę. Nigdy `catch (e) {}`.

**Użytkownik nigdy nie widzi szczegółów technicznych.** Ani ścieżki na dysku,
ani stack trace'a, ani treści błędu z ComfyUI. Kod błędu z listy w `SPEC.md`
§7a i zdanie mówiące, co zrobić dalej.

**Zakaz sklejania komend powłoki.** FFmpeg i darktable uruchamiane przez
`spawn` z tablicą argumentów. Nazwa pliku od użytkownika w komendzie
powłoki to wykonanie dowolnego kodu.

**Zakaz budowania ścieżek z danych wejściowych.** Klient podaje `assetId`,
nigdy ścieżkę. Serwer składa ścieżkę z `STUDIO_DATA_DIR` i wartości z bazy,
po czym weryfikuje, że wynik po normalizacji nadal leży w `STUDIO_DATA_DIR`.

**Kroki i guidance są w workflow JSON, nie w kodzie i nie w prompcie.**
Żadna warstwa nie może ich nadpisać z zewnątrz.

**Żargon nie wychodzi do interfejsu.** Słowa „guidance", „kroki", „seed"
bez wyjaśnienia, „VAE", „ComfyUI", „workflow" nie mają prawa pojawić się
w tekście widocznym dla grafika. Patrz `SPEC.md` §7a.

## Testy

Rygor zbalansowany. Testujemy: kolejkę, budowanie ścieżek, dobieranie jakości
w sharp, mapowanie briefu na parametry, walidację limitu powierzchni obrazu,
każdy route handler (happy path + dwa błędy). Każdy zgłoszony błąd dostaje
najpierw test odtwarzający, potem poprawkę.

Nie testujemy, że ComfyUI generuje obrazy ani że FFmpeg konwertuje wideo.

E2E maksymalnie 5 scenariuszy — lista w `SPEC.md` §14.

## Definicja „skończone"

Kompiluje się bez ostrzeżeń, przechodzi lint, ma testy dla logiki, obsługuje
błędy, bez `console.log`, bez zakomentowanego kodu, zmienne env
w `.env.example`.

**Nie pisz „gotowe", gdy testy nie przechodzą, implementacja jest częściowa
albo napotkałeś błąd, którego nie rozumiesz.**

## Tryb pracy

- Rzeczy trywialne robisz od razu
- Rzeczy nietrywialne: najpierw plan — cel, kroki, zmieniane pliki, czego nie
  ruszasz, jak sprawdzisz, jak cofnąć — potem czekasz na zgodę
- Rzeczy nieodwracalne: pytasz zawsze
- Każde założenie wypisujesz jawnie, żadnych cichych
- Trzy nieudane próby tego samego → stop. Opisujesz, co próbowałeś, co
  dostałeś, jakie masz hipotezy, i oddajesz decyzję właścicielowi
- Jeśli zadanie jest źle postawione, mówisz to **przed** wykonaniem

## Oznaczanie pewności

`[PEWNE]` sprawdzone w kodzie lub dokumentacji · `[PRAWDOPODOBNE]` wniosek ·
`[ZGADUJĘ]` hipoteza. Przy wersjach bibliotek i API weryfikujesz, nie
odpowiadasz z pamięci.

## Kolejność implementacji

Etapy E0–E7 w `SPEC.md` §12. **Nie przechodź do następnego etapu, dopóki
poprzedni nie spełnia swojej definicji ukończenia.**

E0 jest bramką: jeśli seed nie okaże się odtwarzalny przez API ComfyUI,
zatrzymaj się i zgłoś to. Cała iteracja z zachowanym kadrem na tym stoi.

## Czego nie ruszasz

- Instalacji mflux w `~/flux2-klein` — to osobne, działające środowisko
- Plików w `workflows/` bez wyraźnej prośby; to zamrożone parametry modelu
- Niczego poza katalogiem projektu

## Otwarte i niezweryfikowane

Wpisy do potwierdzenia przed implementacją odpowiednich fragmentów:

- czy API ComfyUI daje odtwarzalny seed *(bramka E0)*
- czy `darktable-cli` znosi równoległe uruchomienia *(E6)*
- jakość obrazów z FLUX.2 klein 4B — **nikt jej dotąd nie ocenił**

Zamknięte: `tailscale serve` daje certyfikat Let's Encrypt i bezpieczny
kontekst — sprawdzone 09.09.2026, komplet warunków instalacji PWA spełniony
(szczegóły w `wdrozenie/README.md` §3).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
