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

---

## D22 — Osobne hasła zamiast jednego wspólnego, plus log wejść

**Decyzja.** Osoby z dostępem siedzą w tabeli `users`, każda z własnym skrótem
scrypt. Logowanie pyta **wyłącznie o hasło** — kto to jest, rozpoznajemy po
tym, czyj skrót pasuje. Ciasteczko sesji niesie identyfikator osoby, a bramka
przy każdym żądaniu sprawdza w bazie, czy ta osoba nadal ma dostęp. Każda
próba logowania trafia do `login_events`. Zarządza tym `npm run dostep`.

**Powód.** Panel wychodzi poza tailnet, do Oliwii. Przy jednym wspólnym haśle
w `.env` nie dało się ani odebrać dostępu jednej osobie bez zmiany hasła
wszystkim, ani powiedzieć, kto co uruchomił, ani zauważyć, że ktoś obcy dobija
się do hasła.

**Konsekwencja.** Zastane hasło z `STUDIO_PASSWORD_HASH` przenosi się do tabeli
raz, przy starcie, pod imieniem z `STUDIO_OWNER_NAME` — nikt nie wpisuje niczego
od nowa. Format ciasteczka urósł do czterech pól, więc sesje sprzed zmiany są
nieważne i trzeba zalogować się ponownie. Sprawdzanie hasła **nie przerywa się**
po trafieniu: wcześniejsze wyjście robiłoby z czasu odpowiedzi wskazówkę, która
pozycja na liście pasuje. Dwie osoby nie mogą mieć tego samego hasła, bo log
wejść wskazywałby wtedy nie tę osobę co trzeba.

W logu jest skrót adresu klienta solony sekretem sesji, nie sam adres — do
rozpoznania „to znowu ten sam" wystarcza, a log nie staje się spisem adresów IP.

Limity logowania zacieśnione: **8 prób na pół godziny** z adresu (było 15 na
kwadrans) i **30 na godzinę** globalnie (było 60). Powód: nazwa hosta jest
w publicznych logach przejrzystości certyfikatów, więc po wystawieniu trafiają
tu też skanery.

---

## D23 — Za Funnelem adres klienta bierzemy z nagłówka Tailscale'a

**Decyzja.** `clientKey` rozpoznaje ruch z `tailscale funnel` po nagłówku
`Tailscale-Funnel-Request: ?1` i wtedy liczy limit po adresie z
`X-Forwarded-For`. Poza tym przypadkiem obowiązuje dotychczasowa zasada:
nagłówkowi nie ufamy, chyba że gniazdo jest na liście `TRUSTED_PROXY_IPS`.

**Powód.** Po wystawieniu panelu Funnelem wszystkie żądania z internetu
przychodzą z pętli zwrotnej, więc **limit per adres zdegenerował się do
globalnego**. Zmierzone: dwanaście prób z zewnątrz i wywołania z localhosta
miały ten sam skrót adresu w logu wejść. Skutkiem było to, że jedna osoba
zgadująca hasło zamykała logowanie wszystkim pozostałym — czyli Oliwii
i właścicielowi panelu.

**Konsekwencja.** Zaufanie nagłówkowi jest bezpieczne, bo Tailscale go
**nadpisuje**: przy próbie podszycia się (`X-Forwarded-For: 9.9.9.9` plus
podrobiony znacznik) do aplikacji dotarł adres rzeczywisty, a znacznik wartość
`?1`. Sprawdzone na żywym Funnelu. Po poprawce: dwanaście prób z zewnątrz daje
8 × 401 i 4 × 429, a logowanie z localhosta w tym samym czasie przechodzi
z kodem 200 — kubełki są rozdzielone.

---

## D24 — Alerty macOS zamiast zaglądania do logu

**Decyzja.** Serwer wysyła powiadomienie systemowe (`osascript`) w dwóch
sytuacjach: udane logowanie **z adresu, z którego nikt dotąd nie wchodził**,
oraz wyczerpanie limitu prób. Drugi alert jest dławiony do jednego na godzinę
z tego samego adresu.

**Powód.** Log wejść bez powiadomienia jest wart tyle, co pamięć o zaglądaniu
do niego. Po wystawieniu panelu Funnelem właściciel musiałby wpisywać
`npm run dostep -- wejscia` w nieskończoność, żeby cokolwiek zauważyć.

**Konsekwencja.** Codzienne wejścia z tego samego komputera są ciche —
alarmowanie przy każdym logowaniu zamieniłoby powiadomienia w tło, które
przestaje cokolwiek znaczyć. Wyciek hasła objawi się jako wejście z nowego
adresu, więc sygnał zostaje. O znajomość miejsca pytamy **przed** zapisem do
logu, bo zapis sam czyniłby je znanym. Zmierzone: pierwsze logowanie z danego
adresu daje alert, drugie już nie; dziesięć prób ze złym hasłem daje jeden
alert, nie dziesięć.

---

## D25 — Brak hasła zatrzymuje start zamiast otwierać panel

**Decyzja.** `requiresLogin` przerywa uruchomienie, gdy `STUDIO_PASSWORD_HASH`
jest puste albo `STUDIO_SESSION_SECRET` krótszy niż 32 znaki. Wyłączyć bramkę
można wyłącznie jawnie: `STUDIO_REQUIRE_LOGIN=0`, i wtedy leci ostrzeżenie
przy każdym starcie.

**Powód.** Bramka gasła sama, bez jednej linii w logu. Wystarczyła literówka
w nazwie jednej z dwóch zmiennych albo sekret o znak za krótki, żeby panel
stanął otworem — a przy wystawieniu Funnelem oznacza to otwarty internet.

**Konsekwencja.** `test-setup.ts` musi teraz wyłączać bramkę jawnie, bo testy
nie mają hasła. To jest dowód, że poprawka działa: bez tej linii nie startuje
ani jeden plik testowy.

---

## D26 — Przepustnica na sprawdzanie haseł

**Decyzja.** Najwyżej dwa równoległe sprawdzenia hasła; ponad to od razu 429.
Przepustnica jest nieblokująca — kolejkowanie tylko przesuwałoby problem, bo
czekające żądania i tak trzymają pamięć.

**Powód.** `/api/auth` jest dostępny bez zalogowania, a jedno wywołanie scrypt
zajmuje wątek puli libuv na **318 ms** (zmierzone; komentarz w kodzie obiecywał
„około 100 ms" i mylił się trzykrotnie) i 128 MiB pamięci. Pula ma domyślnie
cztery wątki. Po przejściu na osobne hasła koszt urósł dodatkowo, bo hasło
porównujemy z każdą osobą z dostępem — dwie osoby to 636 ms na próbę.

**Konsekwencja.** Zmierzone: sześć równoległych logowań daje dwa sprawdzenia
i cztery odmowy, a panel odpowiada w trakcie obciążenia w 2,4 ms.

---

## D27 — `/api/uploads` poza proxy, z własnym sprawdzeniem sesji

**Decyzja.** Trasa wgrywania wypada spod `proxy.ts`, a sesji pilnuje
`server/api/sesja.ts` wywoływane w samym handlerze.

**Powód.** Next buforuje ciało żądania dla warstwy pośredniczącej i **ucina je
na 10 MB**. Skutek był taki, że wgranie filmu 19,2 MB kończyło się błędem
`VALIDATION_FAILED`, a filmu 3,2 MB przechodziło — czyli wgrywanie było
zepsute dla wszystkiego powyżej 10 MB od czasu dodania bramki logowania (D15).
Nie wyszło to wcześniej, bo jedyny testowany klip miał 8 MB.

**Konsekwencja.** Komentarz w `proxy.ts` obiecywał, że „route handlery
sprawdzają sesję jeszcze raz u siebie" — **nie sprawdzały**, żadna trasa. Teraz
to prawda przynajmniej dla wgrywania. Zmierzone po poprawce: 19,2 MB przechodzi
i zapisuje się w całości, bez ciasteczka i z podrobionym ciasteczkiem wraca 401.

Sufit wagi zszedł z 512 MB na 100 MB: `Request.formData()` buforuje ciało
wielokrotnie — plik 50 MB dawał 311 MB przyrostu RSS, czyli około
sześciokrotność. Dochodzi odrzucanie po `Content-Length`, **zanim** dotkniemy
ciała.

---

## D28 — O statusie zadania decyduje sygnał, nie sposób powrotu runnera

**Decyzja.** Po powrocie runnera worker sprawdza `controller.signal.aborted`
i zamyka zadanie jako anulowane albo przeterminowane. Jedna funkcja obsługuje
obie ścieżki — powrót i wyjątek.

**Powód.** Nie każdy adapter pilnuje sygnału; eksport przez sharpa nie sprawdza
go wcale. Taki runner kończył pracę normalnie mimo anulowania, a worker
oznaczał zadanie jako **„Gotowe"**, choć nikt na nie już nie czekał.

---

## D29 — Nazwa pliku eksportu rezerwowana atomowo

**Decyzja.** `zajmijNazwe` tworzy pusty plik z flagą `wx` i przy kolizji szuka
kolejnego numeru. Licznik z bazy jest punktem wyjścia, nie rozstrzygnięciem.

**Powód.** Dwa eksporty tego samego slotu mogą biec równolegle
(`NON_GPU_CONCURRENCY` to 2) i oba liczyły tyle samo istniejących plików, bo
żaden jeszcze niczego nie zapisał. Kończyło się nadpisaniem. Sprawdzenie „czy
istnieje", a potem zapis, zostawiałoby to samo okno — `wx` zamyka je atomowo.

---

## D30 — Zdrowie panelu obejmuje bazę i dysk, a klient bazy jest leniwy

**Decyzja.** `/api/health` sprawdza dodatkowo bazę (`select count(*)`) i katalog
danych (prawo zapisu, wolne miejsce, próg 2 GB); `ready` zależy od obu.
Połączenie z bazą otwiera się przy pierwszym zapytaniu, nie przy imporcie
modułu. Bramka w `proxy.ts` łapie awarię bazy i odpowiada 503 z kodem
`DATABASE_UNAVAILABLE`.

**Powód.** Audyt wykazał, że baza wypełniona losowymi bajtami dawała
`/api/health` = `{"ready":true}`, podczas gdy `/api/orders` w tej samej
sekundzie zwracało 500. Po dołożeniu sprawdzenia bazy wyszło coś gorszego:
uszkodzony plik wywracał się **przy imporcie modułu**, więc padała każda trasa,
łącznie z tą jedyną mogącą powiedzieć, co jest nie tak. Grafik dostawał gołe
„Internal Server Error".

**Konsekwencja.** Zmierzone: przy bazie z losowych bajtów panel odpowiada
`503 {"errorCode":"DATABASE_UNAVAILABLE"}` zamiast pustego 500, a komunikat
mówi, co robić. `db` jest pośrednikiem (`Proxy`), więc sam import tego modułu
nigdy nie rzuca.

---

## D31 — Brief wraca do formularza, a etap wynika ze stanu zlecenia

**Decyzja.** `latestBrief` zwraca typowany `Brief | null` przepuszczony przez
`briefSchema.safeParse`; okno briefu dostaje go propem i montuje się dopiero,
gdy dane należą już do wybranego zlecenia (`detail?.order.id === orderId`,
plus `key={orderId}`). Etap na pasku wyprowadzamy ze stanu: brak briefu → 0,
brief bez kadrów → 1, kadry → 2, zaznaczony kadr → 3, eksport → 4.

**Powód.** Makieta zapisywała się do bazy i wracała w odpowiedzi API, ale nikt
jej stamtąd nie czytał — grafik po ponownym otwarciu okna zastawał puste pola
i przepisywał wszystko od zera. Pasek etapów z kolei nigdy nie wychodził poza
„Wybór", bo warunek patrzył wyłącznie na to, czy w zleceniu są jakiekolwiek
pliki.

**Konsekwencja.** Warunek na `detail` jest równie ważny jak `key`: wartości
startowe pól czyta `useState`, czyli **raz, przy montowaniu**. Pierwsza wersja
poprawki przekazywała brief poprawnie, ale okno montowało się przed dojściem
danych i dalej zapisywało pustki — złapane dopiero testem w przeglądarce.
Zmierzone po poprawce: pole tematu wypełnia się treścią z bazy, a pasek
pokazuje „Wybór" dla zlecenia z samymi kadrami i „Eksport" dla zlecenia
z oddanymi plikami.

---

## D32 — Ostrzeżenie o pozach, na których model myli anatomię

**Decyzja.** Brief pokazuje ostrzeżenie, gdy opis sceny zawiera postać w ruchu
albo w powietrzu (`ryzykownaPoza`). Nie blokujemy takiego briefu — czasem
wychodzi — ale grafik ma wiedzieć, że warto policzyć więcej podejść.

**Powód.** Grafik zgłosił kadry z trzema nogami. Zmierzone na FLUX.2 klein 4B,
ten sam numer losowania i te same ustawienia, zmieniany wyłącznie opis pozy:

| poza | kadry z błędem |
|---|---|
| postać w powietrzu (wsad) | **3 z 3** — trzecia noga, brakująca ręka, zdublowana kończyna |
| ta sama postać stojąca | **0 z 2** |

Podniesienie kroków z 4 na 8 **nie pomogło** — obraz wyszedł ładniejszy, ale
trzecia noga została, przy koszcie 40 s zamiast 24 s. To nie jest kwestia
budżetu próbkowania, opisu sceny ani warstwy promptowej: rozrzucone kończyny
w locie są dla modelu tej wielkości najtrudniejszym przypadkiem.

**Konsekwencja.** Model zostaje 4B (D5). `flux2-klein-9b` istnieje w mfluxie,
ale 4B zajmuje już 17,95 GB przy 32 GB pamięci maszyny, więc większy wariant
i tak się nie mieści — sprawdzone, zanim padła propozycja.

Zapisujemy też, że zdanie z `workflows/flux2-klein-t2i.json` o tym, że
podnoszenie kroków „szkodzi", jest nieścisłe: przy 8 krokach kadr był lepszy,
nie gorszy. Kroki zostają na 4 ze względu na czas, nie na jakość.

---

## D33 — Osobny token czerwieni do tekstu

**Decyzja.** `--color-danger` zostaje `#d9534f` zgodnie z tabelą kolorów
w SPEC §10 i służy obramowaniom oraz tłom. Do napisów dochodzi
`--color-danger-text: #e8736f`.

**Powód.** Zmierzone: `#d9534f` daje 4,30:1 na `surface-1` i 3,82:1 na
`surface-2`, przy wymaganych przez SPEC 4,5:1. Nowy odcień daje 5,77:1
i 5,13:1. Podmiana samego tokenu byłaby odstępstwem od palety zapisanej
w specyfikacji, a rozdział jest zgodny z WCAG: obramowania mają próg 3:1,
tekst 4,5:1 — jeden token nie musi spełniać obu.

**Konsekwencja.** Liczby z audytu dla proponowanego odcienia (6,1 i 5,4) były
zawyżone; policzone na nowo wychodzi 6,24 i 5,13.

---

## D34 — Okno modalne zatrzymuje focus i blokuje przewijanie tła

**Decyzja.** `Dialog` przechwytuje `Tab` i `Shift+Tab`, zapętlając focus po
elementach panelu, oraz ustawia `overflow: hidden` na `body` na czas otwarcia.

**Powód.** Focus wychodził z okna na stronę pod spodem, której **nie widać** —
okno ją przykrywa. Grafik pracujący z klawiatury tracił kursor i nie miał jak
się zorientować, gdzie jest.

**Konsekwencja.** Zmierzone w przeglądarce: 40 naciśnięć Tab i 20 Shift+Tab —
**ani razu** poza oknem, przy 15 różnych odwiedzonych elementach, czyli focus
faktycznie krąży, a nie stoi w miejscu. Przewijanie tła wraca po zamknięciu.

---

## D35 — Sufit na długość zapętlanego odcinka

**Decyzja.** Montaż z pętlą odrzuca odcinek dłuższy niż 15 s. Liczymy długość
**po przycięciu**, bo to ona trafia do filtra — zapętlenie 8 s wyciętych
z materiału dziesięciominutowego jest w porządku.

**Powód.** Filtr `reverse` trzyma cały odwracany materiał w pamięci. Zmierzone
na tej maszynie: **1,99 GB dla 20 s w 1080p**, czyli około 100 MB na sekundę.
Nic tego nie ograniczało — przy limicie wgrania 100 MB da się przysłać klip na
kilka minut, a jego zapętlenie sięgnęłoby dziesiątek gigabajtów przy 32 GB
pamięci maszyny.

**Konsekwencja.** Piętnaście sekund to zapas nad pętlą 10-sekundową, o której
mówi SPEC §679.

---

## D36 — Endpoint plików obsługuje zakresy bajtów

**Decyzja.** `/api/files/[assetId]` zawsze wysyła `Accept-Ranges: bytes`,
a przy nagłówku `Range` oddaje 206 z `Content-Range`. Błędny zakres to 416,
brak nagłówka to 200.

**Powód.** Bez tego przeglądarka ściągała cały plik, zanim pokazała cokolwiek,
i nie dawała przewijać podglądu wideo — pasek postępu był martwy.

**Konsekwencja.** Zmierzone: `bytes=0-1023` → 206 i `content-range:
bytes 0-1023/2846179`; `bytes=-500` → ostatnie 500 bajtów; `bytes=99999999-`
→ 416. Fragment `bytes=1000-2023` porównany bajt po bajcie z wycinkiem pliku
z dysku — sumy kontrolne identyczne.

---

## D37 — Kopia zapasowa przez `database.backup()`, nie przez kopiowanie pliku

**Decyzja.** `npm run kopia` robi zrzut bazy przez `database.backup()`,
synchronizuje `orders/` rsynkiem i **otwiera zrobioną kopię**, przepuszczając
ją przez `quick_check`. Retencja: 7 dziennych i 4 tygodniowe. Codzienny
LaunchAgent w `wdrozenie/pl.sygnar.kopia.plist`.

**Powód.** Nie było żadnej kopii — ani skryptu, ani Time Machine
(`tmutil destinationinfo` → „No destinations configured"). W katalogu leżą
pliki oddane klientom, a sam wiersz w bazie bez pliku PNG jest bezużyteczny.

D2 uzasadniała wybór SQLite zdaniem, że „backup to skopiowanie folderu".
**To nieprawda dla samego pliku bazy.** Zmierzone: baza w trybie WAL z 500
wierszami, `copyFileSync` pliku `.db` → kopia, w której tabela w ogóle nie
istnieje, bo wszystko siedziało jeszcze w dzienniku. `backup()` → komplet 500
wierszy.

**Konsekwencja.** Kopia jest sprawdzana przy tworzeniu, nie przy odtwarzaniu —
kopia, której nie da się otworzyć, jest bezwartościowa, a wychodzi to na jaw
w najgorszym możliwym momencie. Odtworzenie sprawdzone na żywo: panel
uruchomiony na kopii pokazał komplet 6 zleceń i wydał zarówno kadr, jak
i zmontowane wideo.

Kopia na tym samym dysku nie chroni przed awarią dysku — to zapisane wprost
w dokumentacji, razem z zaleceniem nośnika zewnętrznego.

---

## D38 — `/api/health` zostaje za bramką, do sprawdzania wdrożenia jest `/api/zyje`

**Decyzja.** Nowy publiczny endpoint `/api/zyje` odpowiada stałym `{ok:true}`.
`/api/health` zostaje chroniony.

**Powód.** `wdrozenie/README.md` kazał sprawdzać wdrożenie przez `/api/health`,
który stoi za bramką i zwracał 401 — komenda z instrukcji nie mówiła nic
o stacji. Otwarcie `/api/health` byłoby jednak złym rozwiązaniem: zdradza
dokładne wersje ffmpeg, mfluxa i sharpa oraz wolne miejsce na dysku, a panel
stoi w internecie. To gotowa podpowiedź dla kogoś szukającego znanych dziur
w konkretnej wersji.

**Konsekwencja.** `/api/zyje` nie mówi niczego, czego nie widać po samym tym,
że serwer odpisał.

---

## D39 — E2E ma własny katalog danych i własny port

**Decyzja.** Scenariusze end-to-end biegną na `.e2e-dane` (ścieżka bezwzględna),
na porcie 3100, z `reuseExistingServer: false` i `globalSetup` zakładającym
świeżą bazę migracją. Bramka logowania jest tam wyłączona jawnie przez
`STUDIO_REQUIRE_LOGIN=0`.

**Powód.** `command: 'npm run start'` brał produkcyjny `.env`, a
`reuseExistingServer: true` podpinał się do **działającego serwera grafika**.
Testy zakładały zlecenia w jego bazie i nie było ani jednego `afterEach`, który
by je sprzątał. Uruchomienie pełnego zestawu na maszynie z pracą klientów
zostawiłoby po sobie śmieci w prawdziwych danych.

Osobno: `webServer.url` wskazywał `/api/health`, który po dodaniu bramki (D15)
zwraca 401 — serwer nigdy nie zostałby uznany za gotowy.

**Konsekwencja.** Zmierzone: po przebiegu baza testowa ma 1 zlecenie, baza
grafika nadal 6. Katalog danych jest teraz tworzony przed migracją także
w `instrumentation-node.ts` — wcześniej pierwsze uruchomienie w pustym
katalogu kończyło się błędem „Cannot open database because the directory
does not exist" i panel wstawał z pustym schematem.

---

## D40 — Testy mają odrzucać zepsutą implementację, nie tylko przechodzić

**Decyzja.** Test doboru jakości w sharpie sprawdza **maksymalność**: koduje
o stopień wyżej i wymaga, żeby wynik już się nie mieścił.

**Powód.** Poprzednia wersja miała jedną asercję — luźniejszy limit daje jakość
nie niższą niż ciaśniejszy. Implementacja zwracająca **zawsze** najniższą
jakość przechodziła ją bez mrugnięcia, bo 30 ≥ 30. Test o nazwie „wybiera
najwyższą jakość mieszczącą się w limicie" nie sprawdzał niczego takiego.

**Konsekwencja.** Kontrola negatywna: po ustawieniu górnej granicy
wyszukiwania na 30 nowy test upada, stary przechodził. Ta sama zasada dotyczy
dopisanych testów zakresów bajtów — nie mają cichego pomijania przy nieudanym
przygotowaniu, bo dokładnie ta pułapka zdarzyła się już raz w tym projekcie
(testy ffmpega przechodzące pusto przez nieistniejącą ścieżkę do binarki).

---

## D41 — `--tools ""` zamiast `--allowed-tools ""`, i zamknięte wejście procesu

**Decyzja.** Claude Code jest wołany z `--tools ""` oraz
`stdio: ['ignore', 'pipe', 'pipe']`.

**Powód.** `--allowed-tools` ogranicza wyłącznie **uprawnienia** — definicje
narzędzi i tak lecą do modelu. Zmierzone na tej maszynie, po trzy przebiegi:

| przełącznik | odczyt z cache'u | zapis do cache'u | razem |
|---|---|---|---|
| `--allowed-tools ""` | 19 150 | ok. 9 720 | **ok. 28 900** |
| `--tools ""` | 0 | ok. 6 215 | **ok. 6 215** |

Audyt podawał „29× więcej tokenów wejścia" — to liczba zawyżona i licząca
inaczej. Rzeczywista różnica to około **4,6×**, i widać ją dopiero w polach
cache'u, bo samo `input_tokens` wynosi 2 w obu przypadkach.

Bez `stdio: ['ignore', …]` CLI czeka trzy sekundy na dane ze standardowego
wejścia, których nigdy nie dostanie, i wypisuje ostrzeżenie. Zmierzone:
5846 ms wobec 2822 ms.

**Konsekwencja.** `prompt_runs.input_tokens` zapisywał stale **2**, choć realny
kontekst szedł w dziesiątki tysięcy — pole miało być miarą zużycia, a nie było.
Zapisujemy teraz cały kontekst. Po zmianie pierwszy zapis to 2 268 tokenów.

---

## D42 — Zakazy §4.6 rozbite, a „czego unikać" przepisywane na pozytyw

**Decyzja.** Zakazy dzielą się na `NO_LETTERING` (pomijane, gdy grafik zadał
napis) i `ALWAYS` (anatomia, brak kontaktu wzrokowego, brak znaków marek) —
doklejane zawsze. Pole „czego unikać" przechodzi przez słownik przepisujący
typowe zakazy na sformułowania pozytywne.

**Powód.** Zakazy były jednym napisem doklejanym **tylko wtedy, gdy nie było
napisu w kadrze**. Przy zadanym napisie znikała razem z „bez liter" także
reguła o anatomii — akurat ta, która przy postaciach waży najwięcej i której
brak grafik zgłosił jako kadry z trzema nogami.

Pole „czego unikać" składacz porzucał zupełnie, a komunikat mówił, że
„zostało przy opisie po polsku", co brzmiało jakby jednak trafiło do promptu.

**Konsekwencja.** Model obrazu nie ma negatywnego promptu — „bez ludzi" działa
w nim podobnie jak „ludzie", bo liczy się obecność słowa. Zakaz musi wejść jako
opis tego, co ma być **zamiast**. Słownik jest celowo krótki: czego nie
rozpoznamy, tego nie zgadujemy, a grafik dostaje wprost informację, że pole
zostało pominięte.

Pierwsza wersja tej poprawki dopisywała zakaz do tablicy **po** złożeniu
opisu, więc nie robiła nic — złapane testem, nie typecheckiem.

---

## D43 — Galeria dostaje miniatury, nie pliki źródłowe

**Decyzja.** `/api/files/[assetId]?miniatura` zwraca WebP o szerokości 320 px,
policzony sharpem przy pierwszym żądaniu i zapisany w `orders/<id>/thumbs/`.
Miniatury nie mają wiersza w bazie — powstają na żądanie i wolno je skasować
bez straty.

**Powód.** Kafelki siatki wstawiały **pełne pliki źródłowe**. Zmierzone:
jedno zlecenie z pięcioma klipami to 46 MB przy każdym otwarciu galerii,
inne 30 MB. Przez Funnel, z telefonu, jest to nie do przyjęcia.

**Konsekwencja.** Zmierzone na pojedynczym kadrze: 1 650 791 B → 7 382 B, czyli
224 razy mniej; drugie żądanie schodzi z dysku w 7 ms. W przeglądarce, na
prawdziwym zleceniu: **108 KB zamiast ok. 30 MB**. Gdy skalowanie się nie uda,
trasa oddaje oryginał — uszkodzony kadr nie ma znikać z galerii przez brak
miniatury.

---

## D44 — `EXPORT_FAILED` jako osobny kod

**Decyzja.** Eksport rzuca `EXPORT_FAILED`, nie `COMFY_WORKFLOW_INVALID`.

**Powód.** Ten drugi mapuje się na komunikat „coś jest nie tak z ustawieniami
**generowania**". Grafik, który właśnie eksportował gotowy kadr, szukałby błędu
zupełnie gdzie indziej. `EXPORT_WEIGHT_UNREACHABLE` też nie pasował — jest
o wadze pliku, a przyczyną bywa co innego.

---

## D45 — Sufit VBV tylko dla H.264

**Decyzja.** `-maxrate` i `-bufsize` dokładamy wyłącznie przy `libx264`.
AV1 dostaje sam cel średni `-b:v`.

**Powód.** `-b:v` jest celem średnim: koder przekracza go na trudnych
fragmentach i nadrabia na łatwych. Przy krótkiej pętli z ruchem nie ma czym
nadrobić, więc plik wychodził ponad zadaną wagę.

**Konsekwencja.** Pierwsza wersja dokładała te argumenty obu kodekom
i **wywróciła AV1**: `Could not open encoder before EOF`, kod -22. Sprawdzone
na żywym montażu — SVT-AV1 ma własny tryb sterowania przepływnością i nie
przyjmuje tej pary obok `-b:v`. Po ograniczeniu do H.264 montaż z limitem
2 MB dał 0,82 MB w MP4 i 0,43 MB w WebM.

Gdyby nie uruchomienie prawdziwego montażu, ta zmiana trafiłaby na produkcję
jako „poprawka wagi pliku", która całkowicie psuje drugi format.

---

## D46 — Zdrowie katalogu danych sprawdzamy zapisem, nie bitem uprawnień

**Decyzja.** `sprawdzDysk` zapisuje i kasuje plik `.probka-zapisu` zamiast
pytać `access(W_OK)`.

**Powód.** Bit uprawnień bywa ustawiony tam, gdzie zapis i tak padnie: nośnik
zamontowany tylko do odczytu, pełny dysk, reguła ACL. Zdrowie ma mówić, czy da
się pracować, a nie czy teoretycznie wolno.

---

## D47 — Miniatura klipu to obrazek, nie element `<video>`

**Decyzja.** Kafelek wideo w siatce jest `<img>` wskazującym
`?miniatura`; trasa wyciąga klatkę ffmpegiem i zapisuje ją obok.

**Powód.** Pierwsza wersja poprawki #43 wstawiała `<video preload="metadata">`.
Po dodaniu obsługi `Range` (D36) okazało się to **gorsze niż stan wyjściowy**:
przeglądarka wysyłała 29 żądań częściowych i ściągała **228 MB** przy galerii
ważącej 46 MB — pięciokrotnie więcej niż przed jakąkolwiek zmianą.

**Konsekwencja.** Zmierzone po naprawie: 5 żądań i **0,06 MB**. Klatkę bierzemy
z pierwszej sekundy, nie z zerowej, bo początek klipu bywa czarny.

Warto zapamiętać sam przebieg: dwie poprawki, każda z osobna słuszna
i zmierzona, złożyły się na regresję gorszą niż stan wyjściowy. Wyszło to
wyłącznie dlatego, że po zamknięciu kategorii zmierzyłem galerię jeszcze raz,
zamiast uznać temat za zamknięty.

---

## D48 — Nagłówki ochronne i wyciszony `X-Powered-By`

**Decyzja.** `next.config.ts` dokłada `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` i wąskie CSP; `poweredByHeader`
wyłączone. Trasa plików dostaje `nosniff` osobno.

**Powód.** Panel stoi w internecie za Funnelem, więc odpowiedzi trafiają też
do skanerów, a `X-Powered-By: Next.js` mówi im, czego szukać. CSP może być
wąskie, bo aplikacja nie ładuje niczego z zewnątrz.

**Konsekwencja.** `'unsafe-inline'` dla stylów jest wymuszone przez Tailwind
i Next. Sprawdzone w przeglądarce po wdrożeniu: lista zleceń, galeria
i okno briefu działają, **zero naruszeń CSP w konsoli**.

---

## D49 — Sesje da się unieważnić, a ciasteczko żyje 12 godzin, nie tydzień

**Decyzja.** `users.sessions_valid_from` odcina sesje wydane wcześniej;
`npm run dostep -- wyloguj <imię>` ustawia ten znacznik. `SESSION_TTL_MS`
schodzi z 7 dni na 12 godzin. Chwilę wydania wyliczamy z terminu ważności,
więc format ciasteczka się nie zmienia.

**Powód.** Panel wylogowuje po 30 minutach bezczynności, ale **w przeglądarce**
— samo ciasteczko było ważne 336 razy dłużej. Kto je przechwycił, mógł go
używać przez tydzień. Do tego jedynym sposobem na wyrzucenie kogoś z cudzego
urządzenia było odebranie mu dostępu w całości.

---

## D50 — Otwarte przekierowanie po zalogowaniu

**Decyzja.** `bezpieczneWejscie` odrzuca `//`, `/\` i wszystko, co nie zaczyna
się od pojedynczego ukośnika.

**Powód.** Warunek `startsWith('/')` przepuszczał `//zly-adres.pl` — to też
zaczyna się od ukośnika, a przeglądarka czyta taki zapis jako adres
bezwzględny z bieżącym protokołem. Przy panelu wystawionym publicznie dawało
to link „zaloguj się i wróć" prowadzący gdzie indziej.

---

## D51 — Osobny token granicy pól formularza

**Decyzja.** `--color-field: #707070` używany wyłącznie przez pola wejściowe.
`--color-line` zostaje `#333333` zgodnie ze SPEC §10 i nadal obsługuje ramki
paneli.

**Powód.** `--line` przy polach dawał kontrast **1,20:1** wobec ich tła — pole
zlewało się z panelem. WCAG wymaga 3:1 dla elementów sterujących.

**Konsekwencja.** Propozycja audytu (`#565656`) dawała **2,06:1**, czyli nadal
za mało — policzone, nie przyjęte na słowo. `#707070` to pierwsza wartość
spełniająca próg: 3,06:1 na `surface-2` i 3,44:1 na `surface-1`.

---

## D52 — Panel mówi czytnikowi ekranu, co się dzieje

**Decyzja.** Pasek kolejki ma zamontowany na stałe obszar `aria-live` ze
zwięzłym zdaniem o stanie. Obszary strony dostały nazwy, doszło przejście do
treści, pola wymagane mają znacznik, a focus wraca tam, skąd otwarto okno.
Ostrzeżenie o wylogowaniu przesunięte z 10 na 30 sekund.

**Powód.** Nic nie ogłaszało końca zadania: osoba niewidoma nie miała jak się
dowiedzieć, że kadry są gotowe, poza cyklicznym sprawdzaniem galerii. Obszary
strony brzmiały identycznie („uzupełniające", „uzupełniające", „główne"), focus
przepadał na `<body>` po zamknięciu okna, a dziesięć sekund nie starcza, żeby
czytnik dokończył wypowiedź i człowiek zdążył zareagować.

**Konsekwencja.** Menu pod trzema kropkami straciło role `menu`/`menuitem` —
deklarowały obsługę strzałek, której nie ma. Zwykła lista przycisków odpowiada
temu, co komponent naprawdę robi.

---

## D53 — Poprawki jakości montażu

**Decyzja.** Sześć zmian w adapterze i schemacie wideo:

- **Odwrócony zakres przycięcia** odrzucany walidacją. Sprawdzenie stoi na
  całym zadaniu, nie na wariancie `trim`, bo Zod nie przyjmuje `.refine`
  na członie unii rozróżnianej. Wcześniej FFmpeg przerywał kodem 23,
  a grafik widział komunikat o awarii montażu.
- **Zdublowana klatka na zawrocie pętli** — ostatnia klatka pierwszego
  przebiegu i pierwsza klatka odwróconego były tą samą klatką, co dawało
  widoczne zacięcie. `select='gt(n\,0)'` obcina jedną.
- **`-movflags +faststart`** dla H.264. Zmierzone: w starym pliku `moov`
  leżało poza pierwszymi 2 KB, w nowym stoi na pozycji 72 — plik zaczyna grać
  przed pobraniem całości.
- **Kadrowanie normalizuje wymiar.** Bez `scale` wynik zależał od
  rozdzielczości źródła: z 1080×1962 wychodziło 1080×1920, a z 640×480 —
  270×480. `setsar=1` zeruje próbkowy współczynnik proporcji.
- **Dźwięk wycinany tylko przy pętli.** Odtworzony wstecz brzmi źle, ale klip
  przycięty bez pętli nie ma powodu tracić ścieżki. `-an` leciało
  bezwarunkowo, mimo komentarza obok mówiącego coś przeciwnego.
- **Koniec zmyślania długości.** Przy nieznanej długości podstawialiśmy
  10 sekund; przy klipie trzydziestosekundowym dawało to trzykrotnie zawyżoną
  przepływność i plik trzykrotnie cięższy od zamówionego, po cichu. Teraz
  twardy błąd.

**Zmierzone na prawdziwym montażu:** 1080×1920, SAR 1:1, długość krótsza
o jedną klatkę od podwojonego przycięcia, 759 KB przy limicie 3 MB.

---

## D54 — Plik musi należeć do zlecenia

**Decyzja.** `getOrderAsset(orderId, assetId)` zastępuje `getAsset` w serwisach
montażu i eksportu.

**Powód.** Serwisy brały plik po samym identyfikatorze, więc dało się zamówić
montaż albo eksport **cudzego pliku**, podając własne `orderId` — wynik lądował
w katalogu zamawiającego. Przy jednym grafiku nie miało to znaczenia; odkąd
panel ma więcej niż jedną osobę i stoi w internecie, ma.

**Konsekwencja.** Przy niezgodności wraca `NOT_FOUND`, nie osobny kod —
odpowiedź nie ma zdradzać, że plik istnieje, tylko należy do kogoś innego.

---

## D55 — Wykrywamy brak angielskiego, nie obecność polskiego

**Decyzja.** `looksPolish` liczy udział angielskich słów funkcyjnych. Poniżej
10 % uznaje opis za wymagający tłumaczenia. Ogonki nadal rozstrzygają od razu.

**Powód.** Poprzednia wersja szukała znaków diakrytycznych i garści polskich
słówek, więc opis pisany **bez ogonków** przechodził jako angielski. Zmierzone:
„Puste wnetrze kancelarii, debowe biurko", „Gabinet stomatologiczny rano"
i „Ekipa budowlana przed blokiem" nie były rozpoznawane wcale.

Lista polskich słów jest nieskończona, lista angielskich funkcyjnych — krótka
i zamknięta. Dlatego kryterium jest odwrócone.

---

## D56 — Założenia od modelu przycinamy, nie odrzucamy przez nie całości

**Decyzja.** `assumptions` przechodzi przez `.catch([])` i przycinanie do trzech
**po** walidacji. `prompt_en` nadal twardo.

**Powód.** `.max(3)` odrzucał całą odpowiedź, gdy model wypisał cztery
założenia — poprawny, gotowy opis lądował w koszu przez jedno zdanie
komentarza za dużo.

---

## D57 — Jedno miejsce zapisu do `prompt_runs`, prawdziwy model, wykryte ucięcie

**Decyzja.** Adapter API zwraca zużycie, zapisuje wyłącznie
`services/prompt.ts`. Model odczytujemy z `modelUsage` zamiast wpisywać literał.
Sufit odpowiedzi podniesiony z 2000 na 8000, a `stop_reason: 'max_tokens'`
kończy się błędem.

**Powód.** Dwa miejsca zapisu o różnym kształcie znaczyły, że poprawka
w jednym omijała drugie — ścieżka API nie dostała ani prawdziwego modelu, ani
pełnego kontekstu wejściowego. Zapisywany literał `claude-code-cli` nie mówił,
czym powstał konkretny opis; zmierzone, CLI odpowiada dziś
`claude-haiku-4-5-20251001`. Odpowiedź ucięta limitem wyglądała jak poprawna,
bo kończyła się w połowie zdania, a schemat ją przepuszczał.

---

## D58 — Ramka briefu jest szczelna

**Decyzja.** `renderBrief` zamienia `<` i `>` na znaki kątowe.

**Powód.** Brief trafia do modelu wewnątrz `<brief>…</brief>`. Bez tej zamiany
grafik mógł wpisać `</brief>` w treści i domknąć ramkę przedwcześnie — reszta
jego tekstu wyglądałaby wtedy jak instrukcja od nas, nie jak dane. To obrona
przed przypadkiem, nie przed atakiem: panel ma jednego, znanego użytkownika
na zlecenie.

---

## D59 — Sprzątanie przy wyjściu procesu

**Decyzja.** `armujSprzatanie` rejestruje obsługę `SIGTERM` i `SIGINT`:
przerywa wszystkie biegnące zadania i gasi `caffeinate`. Stan blokady
usypiania przeniesiony na `globalThis`, wzorem reszty projektu.

**Powód.** Ubicie serwera zostawiało osierocone dzieci: mflux albo ffmpeg
mieliły dalej, trzymając pamięć i pisząc do katalogu, którego nikt już nie
pilnuje, a `caffeinate` nie pozwalał maszynie zasnąć. Przy usłudze `launchd`,
która restartuje panel, narastało to z każdym restartem.

Stan w zmiennych modułowych wracał do zera przy przeładowaniu modułów przez
Next — poprzedni `caffeinate` zostawał wtedy bez właściciela.

---

## D60 — Trzy poprawki czytelności kolejki

**Decyzja.**

- **Pełny dysk ma własny kod** `DISK_FULL`. Kody `ENOSPC`, `EACCES`, `EROFS`,
  `EDQUOT` i `EPERM` rozpoznajemy przed zejściem do domyślnego kodu.
- **Pozycja w kolejce liczona w obrębie własnej puli.** Zadania GPU i pozostałe
  stoją w osobnych kolejkach; liczenie ich razem dawało liczbę bez związku
  z czasem oczekiwania — eksport „miał przed sobą" generowanie, na które nie
  czekał.
- **Pasek postępu eksportu nie cofa się.** Każdy format dostaje własny wycinek
  zakresu, tak jak robi to już `runFfmpeg`.

**Powód pierwszego.** `COMFY_WORKFLOW_INVALID` mapuje się na komunikat o błędzie
w konfiguracji modelu. Grafik przy pełnym dysku szukałby więc czegoś, czego nie
da się poprawić, zamiast zwolnić miejsce.

**Zmierzone po poprawce paska:** 0 → 13 → 25 → 38 → 100, monotonicznie.

---

## D61 — Kolumna `starred` dostała endpoint i interfejs

**Decyzja.** `PATCH /api/assets/[id]` z ciałem `{ starred }`, gwiazdka w rogu
kafelka i filtr „tylko odłożone" nad siatką. Do tego `DELETE /api/assets/[id]`
kasujące wiersz i plik.

**Powód.** Kolumna istniała w bazie od pierwszej migracji, a funkcja
`setStarred` w serwisie — bez endpointu i bez interfejsu. Przy ośmiu wariantach
grafik musiał zapamiętać wybrany kadr albo zapisać jego numer losowania gdzieś
obok panelu. Kasowania nie było wcale: odrzucone kadry i nieudane eksporty
zostawały w galerii na zawsze.

**Konsekwencja.** Gwiazdka stoi **obok** kafelka, nie w nim — kafelek jest
przyciskiem, a przycisk w przycisku nie działa. Kasowanie usuwa najpierw plik,
potem wiersz: odwrotna kolejność zostawiałaby przy awarii wiersz wskazujący na
nieistniejący plik, czyli stan, którego galeria nie umie pokazać.

**Zmierzone w przeglądarce:** 12 kafelków, oznaczenie jednego, filtr pokazuje
jeden, zero błędów w konsoli.

---

## D62 — Numery losowania losuje serwer, branżę da się zmienić

**Decyzja.** `seeds` w `generateJobSchema` jest opcjonalne; przy jego braku
`enqueueGeneration` losuje `variants` numerów generatorem kryptograficznym.
`renameOrderSchema` przyjmuje opcjonalną branżę.

**Powód pierwszego.** Losowanie robiła przeglądarka, w **dwóch miejscach
naraz**, przez `Math.random()`. Dwie kopie tej samej reguły rozjeżdżają się
przy pierwszej zmianie, a numer losowania jest jedyną rzeczą pozwalającą
odtworzyć kadr co do piksela — nie powinien zależeć od tego, który przycisk
kliknięto.

**Powód drugiego.** Komentarz przy schemacie twierdził, że branży nie da się
zmienić, bo „siedzi w nazwach plików". Nazwy powstają jednak przy eksporcie,
a nie przy zakładaniu zlecenia, więc pomyłka oznaczała konieczność założenia
zlecenia od nowa. Pliki już oddane zachowują swoje nazwy.

**Zmierzone:** zadanie wysłane bez `seeds` dostało od serwera
`[385035724, 1799275389]`.

---

## D63 — Domknięcie kategorii III

Zmiany, których nie warto opisywać osobno, ale które warto mieć zapisane:

- **Pętla bez ping-ponga nie połowi już przepływności.** `loop` z
  `pingPong: false` nie robi w łańcuchu filtrów nic, a mimo to podwajał
  zakładany czas — plik wychodził dwa razy lżejszy i gorszy od zamówionego,
  bez śladu w logu.
- **`videoOperationSchema` usunięty.** Trzymał listę `['trim','loop','crop',
  'poster','export']` nieodpowiadającą implementacji: `poster` i `export` nie
  są operacjami. Nikt go nie używał, więc rozjazd nie dawał o sobie znać —
  i właśnie dlatego był groźny, bo wyglądał na źródło prawdy.
- **Wszystkie cztery limity czasu konfigurowalne.** Dwa były wpisane na
  sztywno, więc na wolniejszej maszynie nie dało się ich podnieść bez zmiany
  kodu.
- **Zajętość katalogu danych widoczna w zdrowiu.** Katalog rośnie bez
  ograniczenia; bez tej liczby właściciel dowiadywał się o problemie dopiero,
  gdy dysk się kończył.
- **Strona zastępcza offline.** Przy nawigacji bez połączenia grafik widział
  systemowy ekran przeglądarki po angielsku. Cache'ujemy **wyłącznie** tę
  jedną stronę — żądania danych mają zawieść normalnie, bo panel umie pokazać
  własny baner, a podstawienie im czegokolwiek byłoby kłamstwem.
- **SPEC.md dostał rozdział „Naniesione decyzje"** z tabelą odstępstw
  i listą rzeczy istniejących w kodzie, których specyfikacja nie opisuje.
  Lista przeznaczeń poprawiona z pięciu roboczych na dziesięć rzeczywistych.
