# Faza 0 — mapa aplikacji

**Data:** 2026-09-10 · **Gałąź:** `chore/audyt-2026-09` · **Stan:** na dziś
**Rola:** architekt (agent `hait`) + rekonesans własny

---

## Założenia

1. Audyt dotyczy stanu na 10.09.2026, po zmianach z ostatnich dwóch dni —
   potwierdzone przez właściciela.
2. Aplikacja działa na tej maszynie i odpowiada: `127.0.0.1:3000` → 200,
   publiczny adres przez Tailscale → 200. Sprawdzone przed pisaniem raportu.
3. Nie zaglądałem do historii gita głębiej niż `main` — analiza sekretów
   w historii należy do sekcji B.

---

## 1. Stack faktyczny

`[PEWNE]` Z `package.json`, nie z założeń.

| warstwa | wersja |
|---|---|
| Next.js | **16.3.4** (App Router, Turbopack) |
| React / React DOM | 19.2.8 |
| TypeScript | ^5 (`strict`, `noUncheckedIndexedAccess`) |
| Tailwind CSS | ^4 |
| Drizzle ORM | ^0.45.2 |
| better-sqlite3 | ^13.0.3 |
| Zod | ^4.5.4 |
| sharp | ^0.35.4 |
| Vitest | ^5.0.0 |
| Playwright | ^1.63.0 |
| ESLint | ^9 |
| `@anthropic-ai/sdk` | ^0.124.0 |

Skrypty: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`,
`test:coverage`, `db:generate`, `db:migrate`, `haslo`, `dostep`, `kopia`,
`doktor`.

**Binarki zewnętrzne** (`.env`):

| narzędzie | ścieżka | stan |
|---|---|---|
| mflux | `~/flux2-klein/.venv/bin` | działa |
| ffmpeg | `/opt/homebrew/bin/ffmpeg` | 9.0.1 |
| darktable | `/Applications/darktable.app/…/darktable-cli` | 5.6.1, od 10.09 |
| Claude CLI | *(puste — domyślna z Homebrew)* | `/opt/homebrew/bin/claude` |

`ANTHROPIC_API_KEY` jest **pusty**; warstwa promptowa idzie ścieżką CLI.

---

## 2. Jak wywoływany jest FLUX.2 klein 4B

`[PEWNE]` **Nie ComfyUI.** Własny adapter uruchamia binarkę mfluxa przez
`spawn` z tablicą argumentów, nigdy przez powłokę.

- binarka: `mflux-generate-flux2` — `src/server/adapters/mflux.ts:22`
- ścieżka składana z `MFLUX_BIN_DIR` — `mflux.ts:60`
- parametry **zamrożone w pliku**, nie w kodzie: `workflows/flux2-klein-t2i.json`
  → model `flux2-klein-4b`, kroki **4**, guidance **1.0**
- wagi: `~/.cache/huggingface/hub/models--black-forest-labs--FLUX.2-klein-4B`,
  **15 GB**

**Zmierzone na tej maszynie** (zapisane w kodzie, `output-presets.ts:18`
i `mflux.ts:161`):

| powierzchnia | czas | szczyt pamięci |
|---|---|---|
| 1,11 Mpx | ~30 s | 17,95 GB |
| 2,08 Mpx | ~93 s | 27,81 GB |
| poprawka kadru 1024×1344 | 108 s | 17,50 GB |

Stąd **jedno zadanie GPU naraz**. Przy 32 GB dwa równoległe generowania nie
mieszczą się z zapasem na system.

**Kto uruchamia:** proces serwera Next.js, w tym samym procesie co aplikacja
(kolejka w pamięci + stan w SQLite).

**Co przy padnięciu procesu:** `zamknijPrzerwane()` w `worker.ts:217`, wołane
przy starcie i przy sygnałach — zadania w stanie `running` dostają kod
`INTERRUPTED_BY_RESTART` i komunikat „Stacja została zrestartowana w trakcie.
Uruchom zadanie ponownie."

---

## 3. Mapa tras

`[PEWNE]` Trzy strony, siedemnaście uchwytów API.

### Strony

| trasa | ochrona |
|---|---|
| `/` | chroniona przez `proxy.ts` |
| `/logowanie` | **publiczna** |
| `/zlecenia/[id]` | chroniona |

### API

Publiczne: `/api/auth`, `/api/zyje`.
Pozostałe piętnaście chronione przez `proxy.ts`.

**Siedem uchwytów sprawdza sesję dodatkowo, samo:** `/api/assets/[id]`,
`/api/assets/[id]/kadruj`, `/api/jobs/[id]/ponow`, `/api/orders/[id]/opisy`,
`/api/orders/[id]/paczka`, `/api/orders/[id]/podsumowanie`, `/api/uploads`.

**Wzorzec dopasowania** (`proxy.ts:87`) wyłącza spod bramki:
`api/uploads`, `_next/`, `ikona-`, `favicon.ico`, `manifest.webmanifest`,
`sw.js`, `offline.html`.

`[PEWNE]` Jedyną trasą API wyłączoną spod proxy jest `api/uploads` — i ona
sprawdza sesję sama. **Dziura nie występuje**, ale konstrukcja opiera się na
zgodności dwóch list w różnych plikach. Do rozważenia w sekcji B.

---

## 4. Mapa ekranów

`[PEWNE]` Aplikacja ma **jeden ekran roboczy** w trzech kolumnach, nie zestaw
widoków.

- **`/logowanie`** — znak marki, jedno pole hasła, przycisk. Tło metaball.
- **`/` i `/zlecenia/[id]`** — ten sam ekran `StudioScreen`:
  - **lewa kolumna** — zakładanie zlecenia, lista zleceń, menu wiersza; zwijana
  - **środek** — pasek etapów, historia zadań, przyciski akcji, podgląd kadru,
    galeria z filtrami
  - **prawa kolumna** — panel kontekstowy (eksport albo montaż), lista „Do
    oddania"; zwijana
  - **dół** — pasek kolejki

---

## 5. Przepływ generowania — od kliknięcia do pliku

`[PEWNE]` Osiem punktów, z odnośnikami:

1. **Okno briefu** → `POST /api/jobs` z `kind: 'image_generate'`
2. **Limit żądań przed walidacją** — `jobs/route.ts:32`
3. **Rozpoznanie rodzaju** przez `jobKindSchema` — `jobs/route.ts:~40`
4. **Walidacja** `generateJobSchema.parse(body)` — `jobs/route.ts:57`
5. **Wstawienie do kolejki** `enqueueGeneration()` — `generation.ts:34`;
   odpowiedź **202** z pozycją w kolejce
6. **Wykonanie** — `registerRunner('image_generate', …)` — `generation.ts:103`;
   wywołanie modelu `generation.ts:61`
7. **Zapis pliku i wiersza** — `registerAsset()` — `generation.ts:81`
8. **Odczyt statusu** — strumień zdarzeń `EventSource('/api/jobs/stream')` —
   `use-queue.ts:16`; nie odpytywanie cykliczne

---

## 6. Model danych

`[PEWNE]` Siedem tabel w SQLite, trzy migracje.

| tabela | zawiera |
|---|---|
| `orders` | zlecenie: nazwa, branża, status, znaczniki czasu |
| `briefs` | makieta briefu per zlecenie |
| `jobs` | zadania: rodzaj, status, parametry, postęp, faza, kod błędu, czasy |
| `assets` | pliki: rodzaj, ścieżka, mime, wymiary, waga, numer losowania, metadane, gwiazdka |
| `prompt_runs` | wywołania warstwy promptowej: model, tokeny, koszt |
| `users` | osoby z dostępem |
| `login_events` | dziennik wejść |

### Ustalenie o wadze architektonicznej

`[PEWNE]` **Kolumna `user_id` występuje w schemacie dokładnie raz** — w tabeli
`login_events` (`schema.ts:165`).

`orders`, `briefs`, `jobs`, `assets` i `prompt_runs` **nie mają właściciela**.
Każda zalogowana osoba widzi i zmienia wszystko.

To nie jest defekt w dzisiejszym układzie — panel ma jedno hasło, a wszyscy
troje pracują nad tymi samymi zleceniami. **Staje się defektem w chwili
przejścia na konta per osoba**, i to jest właściwa miara kosztu tej migracji:
trzeba dodać właściciela do pięciu tabel i rozstrzygnąć, do kogo należą
rekordy już istniejące. Rozwinięcie w sekcji B4.

**RLS nie istnieje i istnieć nie może** — SQLite nie ma mechanizmu Row Level
Security. Izolacja danych, jeśli będzie potrzebna, musi być w warstwie serwisów.

---

## 7. Uwierzytelnianie dziś

`[PEWNE]`

- **Jedno hasło** na panel; osoby rozróżniane po tym, które hasło pasuje
  (`findUserByPassword`).
- Hasła: **scrypt**, koszt 2^17 — zmierzone **318 ms** na próbę.
- **Sesja:** podpisany HMAC-SHA256 żeton w ciasteczku, cztery człony
  `<termin>.<userId>.<nonce>.<podpis>` — `session.ts:33`.
- **Czas życia: 12 godzin** — `session.ts:26`.
- **Atrybuty ciasteczka:** `httpOnly: true`, `sameSite: 'lax'`,
  `secure` **warunkowo** — tylko po HTTPS (`session.ts:102`).
- **Co unieważnia sesję:** upływ terminu, zmiana hasła osoby
  (`invalidateSessions`), zmiana sekretu serwera.
- Dziennik wejść: `npm run dostep -- wejscia`.

---

## 8. Storage

`[PEWNE]`

```
$STUDIO_DATA_DIR/
  studio.db                      baza (WAL)
  orders/<orderId>/
    generated/   uploads/   exports/   thumbs/
```

- **Ścieżki nigdy nie pochodzą od klienta.** Klient podaje `assetId`; serwer
  składa ścieżkę z `STUDIO_DATA_DIR` i wiersza z bazy, po czym sprawdza
  `assertSafeSegment` (`paths.ts:21`).
- **Nazwy plików do oddania** z `buildOutputName()`:
  `<branza>-<slot>-<nr>.<ext>`, np. `legal-services-01.avif`.
- **Adres pliku** to `/api/files/<uuid>` — identyfikator losowy, nieodgadywalny.
- **Czy chroniony:** trasa leży pod `proxy.ts` (nie ma jej na liście wyłączeń),
  ale **sama nie woła `wymagajSesji`** — `files/[assetId]/route.ts`.
  Zależność od jednej warstwy. Do sekcji B.

---

## 9. Liczby

`[PEWNE]`

| | |
|---|---|
| pliki źródłowe `.ts`/`.tsx` | **122** |
| linii w `src/` | **18 144** |
| komponenty | 16 |
| uchwyty API | 17 |
| pliki testowe (jednostkowe) | **28** |
| pliki E2E | 1 (pięć scenariuszy) |
| **testy przechodzące** | **403** |
| migracje bazy | 3 |
| wpisy w dzienniku decyzji | D1–D74 |

---

## 10. Czego nie udało mi się ustalić

1. **Czy `/api/files/[assetId]` przetrwałoby usunięcie wpisu z `proxy.ts`.**
   Dziś jest chroniony jedną warstwą. Nie testowałem obejścia — należy do
   sekcji B, z odtworzeniem.

2. **Ile realnie waży katalog danych i jak rośnie.** `npm run doktor` mówi
   163 MB, ale nie wiem, ile z tego to miniatury, a ile pliki źródłowe.

3. **Czy kolejka przetrwa równoległe uruchomienie dwóch instancji serwera.**
   Stan zadań jest w SQLite, ale wartownik pętli działa w procesie. Nie
   sprawdzałem, co zrobią dwa procesy naraz.

4. **Zachowanie przy zamkniętej klapie laptopa.** Wymienione w zadaniu
   (B2); nie sprawdzone.

5. **Historia gita pod kątem sekretów.** Sprawdzałem 09.09 przy wypychaniu
   i było czysto, ale to nie był systematyczny przegląd całej historii.

### Pytania do właściciela

1. Czy `orders` mają docelowo należeć do osoby, czy pozostać wspólne dla
   zespołu? To zmienia zakres migracji z pięciu tabel na zero.
2. Czy dziennik wejść ma retencję, czy rośnie bez końca?
3. Czy katalog danych ma limit, po którym coś ma się dziać?
