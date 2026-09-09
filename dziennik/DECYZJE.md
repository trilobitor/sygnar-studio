# Dziennik decyzji

Format: numer, data, decyzja, powód, konsekwencja. Wpis raz dodany nie znika —
jeśli decyzja się zmienia, dopisujemy nowy wpis, który ją odwołuje.

---

## D1 — ComfyUI jako jedyny backend generowania

**Data:** 2026-09-08 (ze `SPEC.md` §3) · **Status:** odroczona przez D5

Nie piszemy integracji per model. Workflow jako wersjonowany JSON, nowy model =
nowy JSON, nie nowy kod. Adres ComfyUI w zmiennej środowiskowej.

## D2 — SQLite zamiast PostgreSQL

**Data:** 2026-09-08 (ze `SPEC.md` §3) · **Status:** obowiązuje

Odstępstwo od `01-stack-i-konwencje`, zatwierdzone przez właściciela. Aplikacja
jest jednoosobowa i lokalna, backup to skopiowanie folderu. ORM: Drizzle, żeby
ta sama warstwa zadziałała z Postgresem, gdyby projekt urósł.

## D3 — Adaptery za jednym interfejsem

**Data:** 2026-09-08 (ze `SPEC.md` §3) · **Status:** obowiązuje

Cztery różne mechanizmy (HTTP, subprocess, biblioteka w procesie) ukryte za
wspólnym kontraktem `Adapter<TParams, TResult>`. UI nie wie, co jest pod spodem.

## D4 — Powłoka desktopowa odłożona

**Data:** 2026-09-08 (ze `SPEC.md` §3) · **Status:** obowiązuje

Rdzeń to lokalna aplikacja Next.js z pełnym Node. PWA daje ikonę i okno bez
paska adresu. Tauri — jeśli kiedykolwiek, to później i bez zmian w kodzie.

---

## D5 — mflux jako backend generowania w wersji 1, ComfyUI później

**Data:** 2026-09-08 · **Status:** warunkowa — obowiązuje, jeśli bramka E0 przejdzie

**Decyzja.** Adapter `mflux.ts` jest backendem generowania w wersji 1. ComfyUI
zostaje w kontrakcie adaptera jako druga implementacja do dołożenia bez zmian
w UI, kiedy ktoś potwierdzi bf16 na Apple Silicon.

**Powód.** ComfyUI nie jest zainstalowany na maszynie docelowej, a oficjalna
ścieżka instalacji FLUX.2 klein 4B prowadzi na pliki fp8. Typ `Float8_e4m3fn`
nie ma wsparcia w backendzie MPS PyTorcha — model nie załaduje się na Apple
Silicon. Obejście przez bf16 (~13 GB) lub GGUF jest prawdopodobne, ale nie
znaleziono publicznego potwierdzenia, że ktokolwiek uruchomił ten model
w ComfyUI na Apple Silicon. mflux 0.19.1 działa na tej maszynie dziś:
24 gotowe obrazy w `~/flux2-klein`, ~70 s przy 1344 × 768.

**Konsekwencja.** Odstępstwo od D1 — `workflows/` nie zawiera JSON-ów ComfyUI,
tylko presety mfluxa w tym samym formacie, co jego sidecar `*.metadata.json`.
Reguła twarda z `CLAUDE.md` obowiązuje bez zmian: kroki (4) i guidance (1.0)
są liczbami w pliku presetu, nie w kodzie i nie w prompcie, a warstwa promptowa
nie ma do nich dostępu.

**Co to ułatwia.** mflux ma `--config-from-metadata`, które odtwarza pełną
konfigurację z sidecara — to jest wprost mechanika „powtórz kadr" z SPEC §10.
`--seed` przyjmuje listę, `--auto-seeds N` odpowiada polu `variants` w briefie.

## D6 — upscale jako brakujący etap między generowaniem a eksportem

**Data:** 2026-09-08 · **Status:** obowiązuje, wariant techniczny do pomiaru w E0

**Decyzja.** Między generowaniem a eksportem wchodzi krok skalowania w górę.
`SPEC.md` go nie opisuje w żadnym z etapów E0–E7.

**Powód.** Brief realizacyjny §4.8 wymaga plików do 2400 × 1350 (3,24 Mpx),
a `SPEC.md` §7 ogranicza generowanie do 2 100 000 px, bo model widział
w treningu ~1 Mpx. Bez kroku skalowania te dwa wymagania są sprzeczne.

**Konsekwencja.** Współczynniki są łagodne — liniowo 1,20× dla `services.wide`
i 1,25× dla `hero-showcase`, a `case` 1800 × 1125 nie wymaga skalowania wcale.
Do rozstrzygnięcia pomiarem w E0: czy generować blisko limitu 2,08 Mpx
i skalować minimalnie, czy generować ~1,1 Mpx i skalować 1,64× liniowo.
Kandydaci na skalowanie: Lanczos w sharpie (bez nowej zależności) albo
`mflux-upscale-seedvr2` (już w środowisku, ale to kolejne zadanie GPU).

## D7 — `purpose` to klucz presetu wyjściowego, nie enum kształtów

**Data:** 2026-09-08 · **Status:** obowiązuje

**Decyzja.** Jeden obiekt `OUTPUT_PRESETS` jest źródłem prawdy. Każdy wpis
niesie komplet: proporcje, wymiar generowania, wymiar dostarczany, limit wagi
i człon nazwy pliku. Pole `purpose` w `briefSchema` to klucz tego obiektu,
a enum Zod wywodzi się z jego kluczy — jedna lista, nie dwie.

**Powód.** Odrzucone zostały obie pierwotne opcje. Enum slotów sygnar.pl
(`services.wide`, `cases[i]`, …) zabiłby zlecenia klienckie, o których
`SPEC.md` §1 mówi wprost. Enum abstrakcyjny (`square | story | hero | texture`)
wymuszałby drugie mapowanie przy eksporcie i zostawiał `buildOutputName()`
bez członu nazwy, bo brief nazywa pliki slotem: `legal-services-ads.webp`.

**Konsekwencja.** Klucze slotowe pochodzą z briefu §4.8, obok nich generyczne
dla zleceń klienckich. Nowy slot to jeden wpis, nie zmiana w trzech plikach.
Zastępuje to enum `purpose` z `SPEC.md` §7 — `SPEC.md` wymaga aktualizacji.

## D8 — limity wagi i wymiary pochodzą z briefu realizacyjnego, nie ze `SPEC.md`

**Data:** 2026-09-08 · **Status:** obowiązuje

**Decyzja.** Tabela §4.8 dokumentu „Sygnar — Brief grafika i wideo" v1.2
jest źródłem prawdy dla wymiarów dostarczanych i limitów wagi.

**Powód.** `SPEC.md` §6 podaje „180 / 160 / 200 / 60 KB" i pomija slot
`heroShowcase` (220 KB), OG (300 KB) oraz GIF newslettera (250 KB).

**Konsekwencja.** `SPEC.md` §6 wymaga aktualizacji. Do rozstrzygnięcia
osobno: brief wymaga pliku `alty.csv` z altem po polsku (6–14 słów) do
każdego oddawanego pliku — `SPEC.md` nie wspomina o tym ani razu.

## D9 — `better-sqlite3` jako sterownik SQLite, nie wbudowany `node:sqlite`

**Data:** 2026-09-08 · **Status:** obowiązuje, do rewizji przy Drizzle 1.0

**Decyzja.** Sterownikiem bazy jest `better-sqlite3` przez dialekt
`drizzle-orm/better-sqlite3`.

**Powód.** Node 26.6 ma wbudowany `node:sqlite` i działa on bez flagi
eksperymentalnej — sprawdzone. Byłby lepszym wyborem, bo `npm install`
nie kompilowałby wtedy niczego natywnie. Dokumentacja Drizzle wymienia
dialekt `drizzle-orm/node-sqlite`, ale w stabilnej wersji 0.45.2 tej ścieżki
**nie ma** — pojawia się dopiero w linii `1.0.0-rc`. Weryfikacja w
`node_modules`, nie w dokumentacji.

**Konsekwencja.** Jedna zależność natywna więcej. Do rewizji, gdy Drizzle 1.0
wyjdzie ze stanu release candidate — wtedy przejście na `node:sqlite` jest
zmianą trzech linii importu.

## D10 — osobna lista kodów błędów dla warstwy API

**Data:** 2026-09-08 · **Status:** obowiązuje, wymaga wpisu w `SPEC.md`

**Decyzja.** `API_ERROR_CODES` żyje obok `JOB_ERROR_CODES` z SPEC §7a.

**Powód.** Tabela w SPEC §7a opisuje awarie *zadań w kolejce*. Route handler
może się wywrócić bez żadnego zadania — na przykład `/api/health` przy błędzie
odczytu dysku. Wciśnięcie tego w listę kodów zadań zatarłoby granicę.

**Konsekwencja.** `SPEC.md` §7a wymaga uzupełnienia o drugą tabelę.
Pierwszy kod: `HEALTH_CHECK_FAILED`. Lista jest zamknięta tak samo jak tamta.

## D11 — własne prymitywy interfejsu zamiast generatora shadcn/ui

**Data:** 2026-09-09 · **Status:** obowiązuje, do rewizji przy pierwszej okazji

**Decyzja.** `src/components/ui/primitives.tsx` zawiera własne komponenty
`Button`, `Field`, `TextInput`, `TextArea`, `Select`, `Dialog`, `EmptyState`.

**Powód.** `SPEC.md` wymienia shadcn/ui w stacku, ale jego generator
(`npx shadcn@latest init`) mimo `--yes` zatrzymuje się na pytaniu o bibliotekę
komponentów i nie da się go uruchomić bez interaktywnego terminala. Dwie próby,
obie zatrzymane na tym samym pytaniu — trzeciej nie było, zgodnie z regułą
z `CLAUDE.md`.

**Konsekwencja.** Prymitywy trzymają się tego samego API co shadcn, więc
podmiana będzie zamianą importów, nie przepisywaniem ekranów. Do zrobienia
przy okazji, gdy ktoś uruchomi generator ręcznie.

## D12 — `caffeinate` per zadanie, nie per proces serwera

**Data:** 2026-09-09 · **Status:** obowiązuje

**Decyzja.** `src/server/queue/keep-awake.ts` uruchamia `caffeinate -i`
na czas zadania GPU i gasi go po zakończeniu, licząc zagnieżdżenia.

**Powód.** „Mac zasypia w trakcie zadania" jest ryzykiem o wysokim wpływie
(`SPEC.md` §15). Trzymanie maszyny wybudzonej przez cały czas życia serwera
byłoby jednak nadużyciem — panel stoi jako usługa systemowa i działa non stop.

**Konsekwencja.** Blokada dotyczy bezczynności, nie zamknięcia klapy.
Zamknięcie klapy MacBooka i tak uśpi maszynę i tego nie obchodzimy.

## D13 — E6 pozostaje niezweryfikowane: darktable nie da się zainstalować

**Data:** 2026-09-09 · **Status:** blokada zewnętrzna

**Decyzja.** Adapter `darktable.ts` i serwis `photo-batch.ts` są napisane
i przechodzą kompilację, ale **nie zostały uruchomione ani razu**.

**Powód.** `brew install --cask darktable` odmawia:
*„Cask 'darktable' has been disabled because it does not pass the macOS
Gatekeeper check! It was disabled on 2026-09-01."* To jest blokada po stronie
Homebrew, nie konfiguracji.

**Konsekwencja.** `/api/health` pokazuje obróbkę wsadową jako jawnie
niedostępną i tak ma zostać. Otwarte pytanie z `CLAUDE.md` — czy `darktable-cli`
znosi równoległe uruchomienia — **nadal jest otwarte** i nie da się go
rozstrzygnąć na tej maszynie. Do czasu instalacji wywołania są i tak
serializowane wewnątrz jednego zadania, więc równoległość nie powstanie
przypadkiem.

## D14 — trzy źródła opisu po angielsku, model językowy przestaje być zależnością krytyczną

**Data:** 2026-09-09 · **Status:** obowiązuje

**Decyzja.** Warstwa promptowa ma trzy źródła, próbowane w tej kolejności
(`PROMPT_BACKEND=auto`):

1. **Claude Code** (`claude -p --system-prompt … --output-format json`) —
   korzysta z subskrypcji zapisanej przy logowaniu, nie wymaga klucza API.
2. **Klucz API Anthropic** — dla kogoś, kto woli rozliczać to osobno.
3. **Składacz deterministyczny** (`services/prompt-builder.ts`) — bez sieci,
   bez kosztu, bez możliwości awarii.

**Powód.** Właściciel ma wykupioną subskrypcję i nie chce drugiego,
osobno płatnego klucza API. Ale ważniejszy jest wniosek architektoniczny:
**brief jest formularzem**. Siedem z dwunastu pól to listy wyboru, a ich
zamiana na angielski to tabela, nie zadanie dla modelu językowego. Pierwotny
projekt zakładał, że cały brief wymaga LLM-a — i to był błąd, bo czynił
zewnętrzną usługę zależnością krytyczną tam, gdzie wystarczy kod.

**Konsekwencja.** Model językowy jest potrzebny wyłącznie do swobodnego opisu
w punkcie pierwszym. Wszystko inne — kolejność informacji, światło, paletę
per branża (brief §4.2), język fotograficzny (§4.4), martwe strefy kadru
(§4.5), zakazy (§4.6) i realia polskie (§4.7) — składa kod, zawsze tak samo.
Gdy żadne źródło sieciowe nie odpowie, składacz oddaje pełną scenę, a grafik
dostaje ostrzeżenie, że punkt pierwszy poszedł bez tłumaczenia.

**Zapis w `prompt_runs`.** Wywołania przez Claude Code są zapisywane jak
każde inne, z modelem `claude-code-cli`. Pole `cost_usd` niesie wtedy
przelicznik zużycia podawany przez CLI, **nie kwotę do zapłacenia** —
na subskrypcji wywołanie liczy się do limitów planu.

**Ostrzeżenia mają pierwszeństwo.** Limit trzech pozycji w `assumptions`
jest twardy (SPEC §6), więc wpisy wymagające reakcji grafika idą przed
informacjami o wartościach domyślnych. Bez tego „przyjąłem fotografię"
wypychało z listy ostrzeżenie o zniekształconym napisie — wykryte testem.

## D15 — logowanie hasłem i limity żądań przed wystawieniem panelu

**Data:** 2026-09-09 · **Status:** obowiązuje

**Decyzja.** Panel dostaje bramkę logowania (`src/proxy.ts`) i limity żądań
na endpointach, które uruchamiają pracę.

**Powód.** `SPEC.md` §13 mówi wprost: w dniu wystawienia poza sieć Tailscale
obowiązkowe stają się autoryzacja i rate limiting. Właściciel chce linku
publicznego, więc ten dzień właśnie nadszedł.

**Jak.** Bez nowych zależności — `node:crypto` wystarcza:
- hasło jako skrót `scrypt` przy koszcie 2^17, porównanie w czasie stałym,
- sesja w ciasteczku `httpOnly` podpisanym HMAC-SHA256, ważna tydzień,
- limity jako kubełek żetonów w pamięci procesu: 12 zadań/min, 30 wgrań/min,
  20 wywołań warstwy promptowej/min, 15 prób logowania na kwadrans.

**Trzy rzeczy, które wyszły dopiero na maszynie:**

1. **Skrót nie może zawierać `$`.** Next rozwija `$nazwa` w plikach `.env`
   jak zmienną powłoki, więc skrót w formacie `scrypt$N$sól$hash` docierał
   do aplikacji obcięty do słowa `scrypt`. Sprawdzone loaderem `@next/env`:
   175 znaków w pliku, 6 w `process.env`. Separatorem jest dwukropek.

2. **`proxy.ts` musi leżeć w `src/`, nie w korzeniu** — na tym samym poziomie
   co `app`. W korzeniu Next go nie widzi i bramka po prostu nie działa.
   W Next 16 `middleware.ts` jest przestarzałe i nazywa się `proxy.ts`.

3. **Wzorzec musi wykluczać całe `_next`, nie tylko `_next/static`.**
   Pod `_next/hmr` siedzi WebSocket hot-reloadu; bramka odpowiadała na jego
   uścisk dłoni przekierowaniem.

**Czego to nie załatwia.** Hasło przeszło przez czat, więc jest spalone dla
czegokolwiek innego. Przed wystawieniem publicznym trzeba je zmienić —
`npm run haslo` generuje nowy skrót.

## D16 — slot OG wychodzi w JPEG, nie w PNG

**Data:** 2026-09-09 · **Status:** obowiązuje, odstępstwo od briefu §4.8

**Decyzja.** Preset `og` produkuje JPEG. Brief realizacyjny przewiduje tam PNG.

**Powód.** Zmierzone na ośmiu prawdziwych kadrach: PNG z paletą wychodzi
353–545 KB przy limicie 300 KB. Slot był martwy dla **każdego** zdjęcia —
grafik dostawał komunikat „Podnieś limit albo zmniejsz kadr", którego nie
da się wykonać, bo wymiar 1200 × 630 narzuca brief, a limitu nie ma jak
ruszyć z panelu. Po zmianie te same kadry wychodzą 136–298 KB przy jakości
91–95.

**Przy okazji.** Komentarz w `sharp.ts` twierdził, że „PNG jest bezstratny",
i z tego powodu PNG szedł jednym strzałem, bez szukania jakości. Kwantyzacja
palety jest stratna — PNG przechodzi teraz tą samą drogą co formaty stratne.

## D17 — reguły sceny dokleja kod, niezależnie od źródła opisu

**Data:** 2026-09-09 · **Status:** obowiązuje, realizacja D14

**Decyzja.** `services/scene-rules.ts` jest jedynym miejscem, w którym żyją
paleta per branża (§4.2), martwe strefy kadru (§4.5), zakazy (§4.6) i realia
polskie (§4.7). `applySceneRules` dokleja je do gotowego opisu **po walidacji**,
niezależnie od tego, czy przygotował go model językowy, czy składacz.

**Powód.** D14 deklarowała, że te reguły „składa kod, zawsze tak samo", ale
implementacja robiła co innego: trzy źródła były alternatywami, nie podziałem
pracy. Reguły mieszkały wyłącznie w składaczu, czyli w gałęzi uruchamianej
dopiero po awarii dwóch pozostałych — **domyślna ścieżka przez model ich nie
stosowała** i dawała kadry gorzej zgodne z briefem niż ścieżka awaryjna.
Temat trafiał na środek kadru, czyli pod nakładki layoutu.

**Konsekwencja.** Do promptu modelu trafia też branża, bo bez niej nie mógł
znać palety. Reguła nie jest doklejana drugi raz, gdy model już ją zastosował.

---

## D18 — Numer montażu czytamy z katalogu, nie z licznika w kodzie

**Decyzja.** `services/video.ts` przed zapisem skanuje katalog `exports`
wzorcem `<branża>-video-NN.mp4` i bierze najwyższy zastany numer plus jeden.
Eksport obrazów zostaje przy liczeniu z bazy (`countExports`), bo tam numer
dzieli się przez liczbę formatów w slocie.

**Powód.** Numer montażu był wpisany na sztywno jako `index: 1`. Drugi montaż
w tym samym zleceniu nadpisywał komplet plików pierwszego — MP4, WebM i planszę
— bez ostrzeżenia, bez błędu i bez śladu w bazie, która nadal pokazywała oba
zadania jako zakończone. Wyszło to dopiero przy pierwszym uruchomieniu E5 na
prawdziwym materiale: drugi render podmienił wynik pierwszego.

**Konsekwencja.** Źródłem prawdy jest katalog, nie baza — przy kolizji ginie
plik na dysku, więc pytamy dysk. Usunięcie pliku z galerii nie cofa numeracji,
co jest zamierzone: numer raz oddany klientowi nie wraca do puli.

---

## D19 — Długość klipu sonduje serwer przy wgrywaniu

**Decyzja.** `POST /api/uploads` puszcza `probeVideo` (ffprobe) na wgrany film
i zapisuje `durationMs`, `width`, `height`. Obrazy idą jak dotąd przez sharpa.

**Powód.** SPEC §"Oś czasu wideo" wymaga trzech operacji montażu: przycięcia,
pętli i kadru. Silnik obsługiwał wszystkie trzy, ale panel oferował tylko dwie
— **przycięcia nie dało się wywołać z interfejsu**, bo panel nie znał długości
materiału i nie miał z czego zbudować zakresu. Rekordy wgranych filmów miały
`durationMs` puste.

**Konsekwencja.** Filmy wgrane wcześniej nie mają długości i dla nich suwaki
się nie pokazują — zamiast zgadywać zakres, panel montuje wtedy całość.
Ponowne wgranie pliku uzupełnia metrykę.

---

## D20 — Panel nasłuchuje tylko na pętli zwrotnej, wejściem jest `tailscale serve`

**Decyzja.** `npm start` uruchamia Nexta z `-H 127.0.0.1`. Jedyne wejście z
zewnątrz to `tailscale serve` pod `https://macbook-pro-kamil.tailbd8aac.ts.net`,
z certyfikatem Let's Encrypt wystawionym przez Tailscale.

**Powód.** Serwer nasłuchiwał na `*:3000`, więc odpowiadał także pod adresem
sieci lokalnej — sprawdzone, `http://192.168.33.9:3000/logowanie` zwracało 200
— a zapora macOS jest wyłączona. Chroniło go tylko hasło. Po związaniu z pętlą
zwrotną oba adresy poza tailnetem odmawiają połączenia.

**Konsekwencja.** Panel nie działa już pod adresem sieci lokalnej ani pod samym
adresem IP tailnetu z portem 3000 — wyłącznie pod nazwą MagicDNS po HTTPS.
Uruchomienie bez Tailscale'a nadal działa na `http://localhost:3000`.

---

## D21 — Szyfrowanie połączenia poznajemy po nagłówku od proxy

**Decyzja.** `polaczenieSzyfrowane` uznaje połączenie za bezpieczne, gdy adres
żądania jest `https:` **albo** gdy przyszedł nagłówek `x-forwarded-proto: https`.
Stąd bierze się flaga `Secure` ciasteczka sesji.

**Powód.** `tailscale serve` kończy TLS u siebie i wchodzi do Nexta zwykłym
HTTP z pętli zwrotnej. Warunek patrzył wyłącznie na adres, więc ciasteczko
sesji **nie dostawało flagi `Secure` mimo szyfrowanego połączenia
z przeglądarką**.

**Konsekwencja.** Nagłówkowi ufamy bez dodatkowej listy adresów, bo po D20
panel nasłuchuje wyłącznie na 127.0.0.1 — z zewnątrz nie da się do niego dojść
inaczej niż przez proxy, które ten nagłówek ustawia samo. Zmierzone: przez
proxy `Secure; HttpOnly; SameSite=lax`, po zwykłym localhoście bez `Secure`,
więc logowanie lokalne nadal działa.
