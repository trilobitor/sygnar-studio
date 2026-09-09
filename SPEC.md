# Sygnar Studio — specyfikacja techniczna v1

> Dokument źródłowy dla Claude Code. Wszystko, co nie jest tu opisane, wymaga
> pytania do właściciela projektu, nie decyzji na własną rękę.

**Wersja:** 1.0 · **Tryb projektu:** mieszany B + C → obowiązuje rygor C

---

## 1. Kontekst

Sygnar produkuje grafikę i wideo na potrzeby własnej strony i zleceń klienckich.
Dziś każde narzędzie żyje osobno: modele generatywne w terminalu, FFmpeg
komendami, eksport ręcznie. Grafik nie jest programistą i nie będzie pracował
w terminalu.

Aplikacja spina te narzędzia w jeden interfejs zorganizowany wokół **zlecenia**.

### Kto z tego korzysta

| Rola | Urządzenie | Dostęp |
|---|---|---|
| Właściciel | MacBook Pro M1 Max, 32 GB | lokalnie |
| Grafik | laptop z Windows | przeglądarka przez Tailscale |

Cała praca obliczeniowa dzieje się na Macu. Laptop grafika jest cienkim
klientem — nie instalujemy tam niczego poza skrótem do PWA.

---

## 2. Zakres

### W wersji 1

- Zlecenia jako główny byt spinający pracę
- Brief po polsku → prompt po angielsku (API Anthropic)
- Generowanie obrazów: FLUX.2 [klein] 4B przez ComfyUI
- Galeria wariantów z seedem i powtarzaniem kadru
- Wgrywanie własnych zdjęć i klipów
- Montaż parametryczny wideo (FFmpeg)
- Eksport obrazów do limitów wagi (sharp)
- Wsadowe zastosowanie presetu darktable do folderu
- Kolejka: jedno zadanie GPU naraz
- PWA instalowalna na laptopie grafika

### Poza wersją 1 — świadomie

- **Generowanie wideo (Wan 2.2).** Nie zmierzono wydajności na Apple Silicon.
  Adapter przygotowany pod dołożenie, funkcja wyłączona.
- **Oś czasu wideo.** Montaż jest parametryczny: przycięcie, pętla, kadr,
  poster, eksport. Nie ma warstw, przenikań ani klatek kluczowych.
- **Penpot.** Zostaje osobnym narzędziem w przeglądarce.
- **darktable jako edytor.** Tylko `darktable-cli` w trybie wsadowym.
- **Autoryzacja.** Sieć Tailscale jest autoryzacją. Patrz sekcja 13.
- **Wielu użytkowników, role, historia audytowa.**

---

## 3. Decyzje architektoniczne

Każda z nich trafia do `dziennik/DECYZJE.md` przy pierwszym commicie.

### D1 — ComfyUI jako jedyny backend generowania

Nie piszemy integracji per model. ComfyUI wystawia REST i WebSocket na porcie
8188. Workflow to plik JSON w repo, wersjonowany. Nowy model = nowy JSON,
nie nowy kod.

Aplikacji jest obojętne, gdzie stoi ComfyUI — `localhost`, Mac przez Tailscale,
wynajęta karta. Adres w zmiennej środowiskowej.

### D2 — SQLite zamiast PostgreSQL

**Odstępstwo od `01-stack-i-konwencje`. Zatwierdzone przez właściciela 08.09.2026.**

Aplikacja jest jednoosobowa i lokalna. Plik bazy leży obok katalogu zleceń,
backup to skopiowanie folderu. ORM: Drizzle — ta sama warstwa działa
z Postgresem, gdyby projekt urósł.

### D3 — Adaptery za jednym interfejsem

Cztery różne mechanizmy (HTTP, subprocess, biblioteka w procesie) ukryte za
wspólnym kontraktem. UI nie wie, co jest pod spodem.

### D4 — Powłoka desktopowa odłożona

Rdzeń to lokalna aplikacja Next.js z pełnym Node — uruchamia FFmpeg i sharp
bez żadnej powłoki. PWA daje ikonę i okno bez paska adresu. Tauri, jeśli
kiedykolwiek, później i bez zmian w kodzie.

---

## 4. Architektura

```
┌─────────────────────────────────────────────┐
│  Przeglądarka (Mac lub laptop grafika)      │
│  PWA · Next.js App Router                   │
└───────────────────┬─────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼─────────────────────────┐
│  Serwer Next.js (Mac, port 3000)            │
│  ┌──────────────────────────────────────┐   │
│  │ route handlers  ·  walidacja Zod     │   │
│  ├──────────────────────────────────────┤   │
│  │ queue — jedno zadanie GPU naraz      │   │
│  ├──────────────────────────────────────┤   │
│  │ adaptery                             │   │
│  │  comfy   ffmpeg   sharp   darktable  │   │
│  │  prompt (API Anthropic)              │   │
│  ├──────────────────────────────────────┤   │
│  │ SQLite  ·  katalog zleceń na dysku   │   │
│  └──────────────────────────────────────┘   │
└───────────────────┬─────────────────────────┘
                    │ HTTP + WS :8188
┌───────────────────▼─────────────────────────┐
│  ComfyUI (Mac)  ·  FLUX.2 klein 4B          │
└─────────────────────────────────────────────┘
```

### Struktura katalogów

Zgodna z `01-stack-i-konwencje`, sekcja „Struktura katalogów".

```
src/
├── app/
│   ├── (studio)/
│   │   ├── page.tsx                  # lista zleceń
│   │   └── zlecenia/[id]/page.tsx    # ekran roboczy
│   └── api/
│       ├── orders/
│       ├── jobs/
│       ├── uploads/
│       ├── files/[assetId]/
│       └── health/
├── components/
│   ├── ui/                           # shadcn
│   ├── brief/
│   ├── gallery/
│   ├── video/
│   └── queue/
├── lib/
│   ├── env.ts                        # walidacja Zod przy starcie
│   └── format.ts
├── server/
│   ├── db/
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── queue/
│   │   ├── worker.ts
│   │   └── store.ts
│   ├── adapters/
│   │   ├── types.ts
│   │   ├── comfy.ts
│   │   ├── ffmpeg.ts
│   │   ├── sharp.ts
│   │   ├── darktable.ts
│   │   └── prompt.ts
│   └── services/                     # bez importów z next/*
│       ├── orders.ts
│       ├── generation.ts
│       └── export.ts
├── types/
└── styles/

workflows/                            # JSON ComfyUI, wersjonowane
├── flux2-klein-t2i.json
└── flux2-klein-edit.json
```

**Reguła twarda:** `server/services/` nie importuje niczego z `next/*`.

---

## 5. Model danych

Nazwy tabel `snake_case`, liczba mnoga. Klucze obce `<tabela_pojedyncza>_id`.

```sql
-- Zlecenie: byt spinający całą pracę
CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  industry        TEXT,                    -- legal | medical | estate | build | other
  status          TEXT NOT NULL,           -- draft | active | done | archived
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Brief wypełniony przez grafika
CREATE TABLE briefs (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payload_json    TEXT NOT NULL,           -- zgodny z briefSchema
  created_at      INTEGER NOT NULL
);

-- Zadanie w kolejce
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,           -- image_generate | video_render | image_export | photo_batch
  status          TEXT NOT NULL,           -- queued | running | done | failed | cancelled
  params_json     TEXT NOT NULL,
  progress        REAL NOT NULL DEFAULT 0, -- 0..1
  phase           TEXT,                    -- etykieta dla UI
  error_code      TEXT,                    -- kod, nigdy treść błędu wewnętrznego
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER
);

CREATE INDEX jobs_status_created_idx ON jobs(status, created_at);
CREATE INDEX jobs_order_idx ON jobs(order_id);

-- Każdy plik w systemie
CREATE TABLE assets (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,           -- generated | uploaded | export | poster
  path            TEXT NOT NULL,           -- względem STUDIO_DATA_DIR
  mime            TEXT NOT NULL,
  bytes           INTEGER NOT NULL,
  width           INTEGER,
  height          INTEGER,
  duration_ms     INTEGER,
  seed            INTEGER,
  metadata_json   TEXT,
  starred         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE INDEX assets_order_kind_idx ON assets(order_id, kind);

-- Rygor C: każde wywołanie modelu językowego jest zapisane
CREATE TABLE prompt_runs (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cost_usd        REAL NOT NULL,
  brief_json      TEXT NOT NULL,
  prompt_en       TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
```

### Układ plików na dysku

```
STUDIO_DATA_DIR/
├── studio.db
└── orders/
    └── <order_id>/
        ├── generated/
        ├── uploads/
        └── exports/
```

Ścieżki w bazie są **względne** wobec `STUDIO_DATA_DIR`. Kod nigdy nie
buduje ścieżki bezpośrednio z danych wejściowych — patrz sekcja 13.

---

## 6. Kontrakt adapterów

```ts
// server/adapters/types.ts

export type HealthStatus =
  | { ok: true; version?: string }
  | { ok: false; reason: 'unreachable' | 'misconfigured' | 'missing_binary' }

export interface JobProgress {
  /** 0..1 */
  percent: number
  /** Etykieta pokazywana użytkownikowi, po polsku */
  phase: string
}

export interface JobContext {
  signal: AbortSignal
  workDir: string
  onProgress: (progress: JobProgress) => void
  logger: Logger
}

export interface Adapter<TParams, TResult> {
  readonly name: string
  /** Sprawdzenie dostępności — wywoływane przez /api/health */
  check: () => Promise<HealthStatus>
  run: (params: TParams, ctx: JobContext) => Promise<TResult>
}
```

Każdy adapter:
- respektuje `signal` i przerywa pracę po anulowaniu,
- raportuje postęp co najmniej raz na 2 sekundy,
- rzuca błąd z kodem, nigdy z treścią przeznaczoną dla użytkownika,
- nie wie nic o Next.js, bazie ani UI.

### comfy.ts

- `POST /prompt` z workflow JSON, w którym podmieniono prompt, seed, wymiary,
  kroki i guidance
- `ws://.../ws?clientId=…` do śledzenia postępu; mapowanie kroków sampler'a
  na `percent`
- `GET /history/{prompt_id}` po nazwy plików wyjściowych
- `GET /view` po pobranie pliku i zapis do katalogu zlecenia
- `POST /upload/image` przy edycji z referencją

**Stałe parametry FLUX.2 klein 4B:** kroki 4, guidance 1.0. Model jest
step- i guidance-distilled; podnoszenie tych wartości szkodzi.
UI nie wystawia ich użytkownikowi.

### ffmpeg.ts

Uruchamiany przez `spawn`, nie `exec` — postęp parsowany ze `stderr`.
Operacje wersji 1:

| Operacja | Efekt |
|---|---|
| trim | przycięcie do zakresu in/out |
| loop | pętla ping-pong (odtworzenie w przód i wstecz) |
| crop | kadr pionowy / kwadratowy / poziomy z zachowaniem środka |
| poster | pierwsza klatka jako JPG |
| export | MP4 H.264 + WebM AV1, docelowa waga jako parametr |

### sharp.ts

W procesie, bez subprocessu. Eksport do AVIF i WebP z **automatycznym
dobieraniem jakości do limitu wagi** — wyszukiwanie binarne po parametrze
`quality`, maksymalnie 8 iteracji, wynik zapisany w `metadata_json`.

Domyślne limity wagi: 180 / 160 / 200 / 60 KB (konfigurowalne per eksport).

### darktable.ts

`darktable-cli <wejście> <preset.xmp> <wyjście>` na folderze.
[NIEPOTWIERDZONE] darktable prawdopodobnie nie pozwala na równoległe
uruchomienia przez blokadę biblioteki — **zweryfikować przed implementacją**
i w razie potwierdzenia serializować wywołania.

### prompt.ts — rygor C

Zamienia brief po polsku na prompt po angielsku.

Wymagania niepodlegające negocjacji:
- limit tokenów wyjścia, timeout, maksymalnie jedna próba ponowienia
- treść briefu jest **danymi, nie instrukcją** — prompt systemowy musi to
  jawnie stwierdzać, a wynik jest walidowany schematem Zod przed użyciem
- każde wywołanie zapisane w `prompt_runs` razem z kosztem
- awaria warstwy promptowej nie blokuje generowania: użytkownik dostaje
  możliwość wpisania promptu ręcznie

Prompt systemowy pochodzi z osobnego pliku `prompts/brief-to-prompt.md`,
wersjonowanego w repo.

---

## 7. Schematy Zod

Jeden schemat = walidacja klienta i serwera. Typy przez `z.infer`.

```ts
export const briefSchema = z.object({
  subject:      z.string().min(3).max(500),   // punkt 1 makiety, jedyny wymagany
  purpose:      z.enum(['square', 'story', 'hero', 'texture', 'other']),
  shot:         z.enum(['closeup', 'medium', 'full', 'wide']).optional(),
  angle:        z.enum(['eye', 'high', 'low', 'top']).optional(),
  timeOfDay:    z.string().max(100).optional(),
  lighting:     z.enum(['natural', 'studio', 'neon', 'candle', 'overcast']).optional(),
  place:        z.string().max(300).optional(),
  mood:         z.string().max(100).optional(),
  colors:       z.string().max(150).optional(),
  style:        z.enum(['photo', 'illustration', 'render3d', 'sketch', 'flat']).optional(),
  textOnImage:  z.string().max(60).optional(),
  avoid:        z.string().max(300).optional(),
  variants:     z.number().int().min(1).max(8).default(4),
})

export const generateJobSchema = z.object({
  orderId:  z.string().uuid(),
  promptEn: z.string().min(10).max(2000),
  width:    z.number().int().min(256).max(2048).multipleOf(16),
  height:   z.number().int().min(256).max(2048).multipleOf(16),
  seeds:    z.array(z.number().int().min(0)).min(1).max(8),
})
```

**Ograniczenie powierzchni:** `width * height` nie może przekroczyć 2 100 000.
Model widział w treningu około 1 megapiksela; większe kadry dają zdublowane
elementy zamiast detalu, a przy 32 GB pamięci grożą wyczerpaniem zasobów.
Walidacja po stronie serwera, nie tylko w UI.

---

## 7a. Wiedza produktowa — gdzie trafia który fragment

Dokument `instructions-projekt-grafika.md` był napisany dla asystenta w czacie.
Aplikacja nie ma czatu, więc jego treść **rozdziela się na trzy warstwy
o różnym cyklu życia**. Nie wolno wkleić go w jedno miejsce.

| Fragment | Warstwa | Zmieniane przez |
|---|---|---|
| Rola, zasady budowy promptu, kolejność opisu | `prompts/brief-to-prompt.md` | edycję pliku |
| Przeznaczenie → wymiary | stała `PURPOSE_DIMENSIONS` + Zod | commit |
| Kroki, guidance, model | **workflow JSON ComfyUI** | nigdy z zewnątrz |
| Makieta briefu | `briefSchema` + formularz | commit |
| Ton, słowniczek, otucha | mikrocopy w komponentach | commit |
| Tabela problemów | mapowanie `error_code` → komunikat | commit |
| Nazewnictwo plików | `buildOutputName()` w `services/` | commit |
| „Jedna zmiana na przebieg" | mechanika UI | commit |

### Parametry stałe przestają być prośbą

W wersji czatowej „nigdy nie podnoś kroków" było instrukcją, którą model mógł
zignorować. Tutaj kroki i guidance są liczbami w workflow JSON. Warstwa
promptowa nie ma do nich dostępu i nie może ich zmienić.

Warstwa promptowa ma **jedno** zadanie: zamienić brief po polsku na opis sceny
po angielsku. Nie dobiera modelu, nie dobiera parametrów, nie decyduje
o rozdzielczości — tę wyprowadza kod ze `purpose` w briefie.

### Ton zmienia nośnik, nie znika

Grafik nie zobaczy w aplikacji ani jednego terminu technicznego bez
wyjaśnienia. Realizacja:

- **Dymki przy polach formularza** — treść ze słowniczka Instructions
- **Puste stany mówią, co zrobić dalej**, nie „brak danych"
- **Komunikaty błędów mówią, co zrobić**, nie co się zepsuło wewnątrz
- **Seed opisany po ludzku** przy każdym wariancie: „numer losowania — ten sam
  numer daje ten sam kadr"
- Słowa „guidance", „kroki", „VAE", „ComfyUI" **nie pojawiają się w UI ani raz**

Jedna reguła przeniesiona wprost: **aplikacja nie chwali wyniku.** Nie ma
komunikatów „świetnie wyszło" — aplikacja nie widzi obrazu. Może potwierdzić,
że zadanie się udało, i tyle.

### Kody błędów → komunikaty

`error_code` w tabeli `jobs` jest identyfikatorem technicznym. UI mapuje go na
zdanie po polsku. Użytkownik nigdy nie widzi kodu ani treści wyjątku.

| `error_code` | Komunikat dla grafika |
|---|---|
| `COMFY_UNREACHABLE` | Stacja jest offline. Napisz do Kamila, żeby ją włączył. |
| `COMFY_WORKFLOW_INVALID` | Coś jest nie tak z ustawieniami generowania — to po naszej stronie, nie po Twojej. |
| `OUT_OF_MEMORY` | Zabrakło pamięci na tak duży kadr. Spróbuj mniejszego formatu. |
| `JOB_TIMEOUT` | Zadanie trwało zbyt długo i zostało przerwane. Spróbuj jeszcze raz. |
| `JOB_CANCELLED` | Zadanie anulowane. |
| `INTERRUPTED_BY_RESTART` | Stacja została zrestartowana w trakcie. Uruchom zadanie ponownie. |
| `UPLOAD_TOO_LARGE` | Ten plik jest za duży. Maksymalnie {limit}. |
| `UPLOAD_UNSUPPORTED_TYPE` | Ten format pliku nie jest obsługiwany. Przyjmujemy JPG, PNG, MP4 i MOV. |
| `FFMPEG_FAILED` | Nie udało się przygotować pliku wideo. Sprawdź, czy klip otwiera się poprawnie. |
| `EXPORT_WEIGHT_UNREACHABLE` | Nie da się zejść do zadanej wagi bez utraty jakości. Podnieś limit albo zmniejsz kadr. |
| `PROMPT_SERVICE_FAILED` | Nie udało się przygotować opisu po angielsku. Możesz wpisać go ręcznie poniżej. |

Lista jest zamknięta. Nowy tryb awarii = nowy kod i nowy wpis, nie ogólne
„wystąpił błąd".

---

## 8. API

Wszystkie route handlery walidują wejście schematem Zod. Odpowiedzi błędne
zwracają kod, nigdy treść wyjątku.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/health` | stan czterech adapterów, do banera w UI |
| GET | `/api/orders` | lista zleceń, limit 50 |
| POST | `/api/orders` | nowe zlecenie |
| GET | `/api/orders/[id]` | zlecenie z assetami |
| POST | `/api/orders/[id]/prompt` | brief → prompt EN |
| POST | `/api/jobs` | dodanie zadania do kolejki, zwraca `jobId` |
| GET | `/api/jobs/[id]` | status pojedynczego zadania |
| GET | `/api/jobs/stream` | SSE ze stanem kolejki |
| DELETE | `/api/jobs/[id]` | anulowanie |
| POST | `/api/uploads` | wgranie pliku do zlecenia |
| GET | `/api/files/[assetId]` | serwowanie pliku po ID, nie po ścieżce |

**Postęp przez SSE, nie odpytywanie.** Jedno połączenie na klienta, stan całej
kolejki. Odpytywanie co sekundę przy zadaniach trwających minuty to marnowanie
zasobów po obu stronach.

---

## 9. Kolejka

- Jeden worker w procesie serwera, jedno zadanie GPU naraz
- Stan trzymany w tabeli `jobs` — restart serwera nie gubi kolejki
- Zadania `running` przy starcie serwera oznaczane jako `failed`
  z kodem `INTERRUPTED_BY_RESTART`
- Anulowanie przez `AbortController` przekazany do adaptera
- Zadania nie-GPU (sharp, poster) mogą działać równolegle z GPU —
  osobna pula
- Twardy timeout per rodzaj zadania, konfigurowalny

**Blokada podwójnego kliknięcia jest wymogiem, nie kosmetyką.** Szczyt pamięci
przy jednym obrazie 1024×1024 zmierzono na 17,95 GB przy 32 GB w maszynie.
Dwa równoległe zadania GPU wyczerpią pamięć.

---

## 10. Interfejs

### Układ

Jeden ekran roboczy, trzy kolumny. Bez zakładek najwyższego poziomu.

```
┌──────────┬────────────────────────────┬──────────────┐
│ Zlecenia │  Podgląd                   │  Panel       │
│          │                            │  kontekstowy │
│ • Sygnar │  ┌──────────────────────┐  │              │
│   Legal  │  │                      │  │  Brief       │
│ • Klinika│  │                      │  │  albo        │
│ • …      │  └──────────────────────┘  │  Montaż      │
│          │  ▣ ▣ ▣ ▣  warianty        │  albo        │
│          │                            │  Eksport     │
├──────────┴────────────────────────────┴──────────────┤
│ Kolejka: 1 zadanie · 00:31 · [Anuluj]                │
└──────────────────────────────────────────────────────┘
```

Etapy jako pasek postępu, nie menu: **Brief → Generowanie → Wybór → Obróbka → Eksport**.

### Okno briefu

Osobne okno modalne otwierane przyciskiem **Nowy brief**, nie panel wciśnięty
w bok. Brief jest głównym aktem pracy grafika i zasługuje na pełną uwagę —
kadr, podgląd i kolejka mu wtedy nie przeszkadzają.

Struktura okna odwzorowuje jedenaście punktów makiety, ale **nie pokazuje ich
wszystkich naraz**:

- **Zawsze widoczne:** „Co ma być na obrazie" (pole wielolinijkowe, wymagane)
  oraz cztery listy wyboru — przeznaczenie, styl, pora dnia, nastrój.
- **Pod zwiniętym „Więcej szczegółów":** ujęcie, miejsce, kolory, tekst na
  obrazie, czego unikać.
- **Stopka okna:** liczba wariantów (domyślnie 4) i jeden przycisk.

Wymagany jest wyłącznie punkt 1. Pozostałe pola puste = wartości domyślne,
a aplikacja **wypisuje jawnie, co uzupełniła za grafika** — na podglądzie
promptu przed uruchomieniem generowania.

Każde pole ma dymek ze słowniczka. Nazwy pól po polsku, bez żargonu.

Brief zapisuje się do `briefs` przy każdym uruchomieniu, więc da się do niego
wrócić i wygenerować ponownie z drobną zmianą.

**Podgląd promptu przed generowaniem.** Grafik widzi angielski opis, który
pójdzie do modelu, i może go poprawić ręcznie. To jest bezpiecznik na wypadek
awarii warstwy promptowej i jednocześnie sposób, w jaki grafik uczy się, co
działa.

Grafik nigdy nie widzi kroków, guidance ani nazwy modelu. **Widzi seed** —
bez niego nie poprosi o poprawkę tego samego kadru.

### Stany do zaprojektowania od początku

Nie są to przypadki brzegowe, tylko normalna praca:

| Stan | Zachowanie |
|---|---|
| Brak połączenia z ComfyUI | baner „Stacja jest offline", formularz zablokowany |
| Kolejka zajęta | „W kolejce, 1 zadanie przed Tobą" |
| Zadanie trwa 8 minut | postęp z etapem i przyciskiem Anuluj |
| Awaria FFmpeg w połowie | komunikat co zrobić dalej, plik częściowy usunięty |
| Podwójne kliknięcie | przycisk zablokowany do odpowiedzi serwera |
| Bardzo długi tekst w polu | limit ze schematu Zod, licznik znaków |
| 100+ kadrów w galerii | wirtualizacja listy, leniwe ładowanie miniatur |
| Puste zlecenie | wyraźne wskazanie pierwszego kroku |
| Brak uprawnień do katalogu | komunikat przy starcie, nie przy pierwszym zapisie |

### Kolor — decyzja warsztatowa, nie estetyczna

**Interfejs wokół podglądu obrazu jest neutralnie szary, nie granatowy.**
Marka Sygnar używa `#0a0d12`; ten odcień zafałszuje grafikowi ocenę koloru
zdjęcia. Darktable, Lightroom i Capture One są szare z tego samego powodu.

```
--surface-0:  #141414   /* tło aplikacji */
--surface-1:  #1c1c1c   /* panele */
--surface-2:  #262626   /* karty, pola */
--border:     #333333
--text:       #e8e8e8
--text-muted: #9a9a9a
--accent:     kolor marki Sygnar — tylko przyciski akcji i stany aktywne
--danger:     #d9534f
```

Pod przezroczystością szachownica. Podgląd obrazu na neutralnym tle,
bez cieni i gradientów wokół.

### Dostępność

Zgodnie z `02-standardy-kodu`: `<label htmlFor>` przy każdym polu, kontrast
min. 4.5:1, wszystko klikalne obsługiwane z klawiatury z widocznym focusem,
`aria-label` przy ikonach, nagłówki bez przeskoków.

---

## 11. Konfiguracja

`lib/env.ts` waliduje przy starcie. Brak zmiennej = aplikacja się nie
uruchamia. `.env.example` zawsze aktualny, bez wartości.

```
COMFY_URL=http://127.0.0.1:8188
STUDIO_DATA_DIR=/Users/<user>/Sygnar/studio
ANTHROPIC_API_KEY=
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
DARKTABLE_CLI_PATH=
MAX_CONCURRENT_GPU_JOBS=1
JOB_TIMEOUT_MS=900000
```

`ANTHROPIC_API_KEY` zostaje na Macu. Laptop grafika nigdy go nie widzi,
bo cała warstwa promptowa działa po stronie serwera.

**Żadna z tych zmiennych nie ma prefiksu `NEXT_PUBLIC_`.**

---

## 12. Kolejność implementacji

Każdy etap kończy się działającą funkcją. Nie przechodzimy dalej, dopóki
poprzedni etap nie spełnia swojej definicji ukończenia.

### E0 — bramka wejściowa

Zanim powstanie linijka aplikacji.

1. ComfyUI uruchomiony, workflow FLUX.2 klein wyeksportowany w formacie API
2. `curl` z workflow JSON → plik PNG na dysku
3. **Ten sam seed dwa razy → identyczny plik**

Punkt 3 jest testem, nie formalnością. Bez powtarzalnego seeda cała iteracja
z zachowanym kadrem przestaje działać i projekt wymaga przeprojektowania.

### E1 — szkielet

Next.js, TS strict, Tailwind, shadcn/ui, Drizzle, migracja tworząca schemat,
`lib/env.ts`, `/api/health` zwracające stan czterech adapterów.

*Ukończone, gdy:* `/api/health` pokazuje ComfyUI jako dostępne, a FFmpeg,
sharp i darktable jako obecne lub jawnie brakujące.

### E2 — generowanie

Adapter comfy, kolejka, zlecenia, galeria wariantów, SSE z postępem.

*Ukończone, gdy:* z UI da się wygenerować cztery warianty, zobaczyć postęp,
anulować w trakcie i powtórzyć kadr z zapisanego seeda.

### E3 — warstwa promptowa

Formularz briefu, `prompt.ts`, tabela `prompt_runs`, ręczna edycja promptu.

*Ukończone, gdy:* brief po polsku daje sensowny prompt po angielsku, koszt
jest zapisany, a awaria API nie blokuje generowania.

### E4 — wgrywanie i eksport obrazów

Upload, `/api/files/[assetId]`, adapter sharp z dobieraniem jakości do wagi.

*Ukończone, gdy:* wgrany JPG wychodzi jako AVIF i WebP poniżej zadanego limitu.

### E5 — montaż wideo

Adapter ffmpeg, panel montażu, podgląd, eksport MP4 + WebM, poster.

*Ukończone, gdy:* z wgranego klipu powstaje 10-sekundowa pętla ping-pong
w kadrze pionowym, w obu formatach, z posterem.

### E6 — wsad darktable

Preset XMP na folderze.

*Ukończone, gdy:* folder RAW-ów wychodzi jako JPG z zastosowanym gradingiem.

### E7 — dostęp i pakowanie

`tailscale serve`, manifest PWA, ikona, usługi `launchd` dla ComfyUI i panelu,
`caffeinate` przy starcie zadania.

*Ukończone, gdy:* grafik klika ikonę na pulpicie Windows i widzi panel bez
uruchamiania czegokolwiek ręcznie.

---

## 13. Bezpieczeństwo

Rygor C. Sieć Tailscale jest jedyną warstwą autoryzacji w wersji 1 —
i to jest decyzja świadoma, obowiązująca **wyłącznie** dopóki aplikacja
nie jest wystawiona publicznie.

**W dniu wystawienia poza Tailscale obowiązkowe stają się:** autoryzacja,
rate limiting na endpointach uruchamiających zadania, limit rozmiaru uploadu.
Endpoint uruchamiający minuty pracy GPU jest celem do wyczerpania zasobów.

Niezależnie od tego, od wersji 1:

- **Ścieżki plików.** Klient nigdy nie podaje ścieżki, tylko `assetId`.
  Serwer składa ścieżkę z `STUDIO_DATA_DIR` i wartości z bazy, a następnie
  weryfikuje, że wynik po normalizacji nadal leży w `STUDIO_DATA_DIR`.
  Brak tej weryfikacji to odczyt dowolnego pliku z dysku.
- **Upload.** Weryfikacja typu po zawartości pliku, nie po rozszerzeniu ani
  nagłówku `Content-Type`. Limit rozmiaru. Nazwa pliku generowana przez
  serwer, nigdy przyjmowana od klienta.
- **Subprocess.** FFmpeg i darktable uruchamiane przez `spawn` z tablicą
  argumentów. **Nigdy przez powłokę i nigdy przez sklejanie stringów** —
  nazwa pliku od użytkownika w komendzie powłoki to wykonanie dowolnego kodu.
- **Prompt injection.** Brief jest danymi. Prompt systemowy stwierdza to
  jawnie, wyjście modelu jest walidowane schematem przed użyciem.
- **Błędy.** Użytkownik dostaje kod i wskazówkę, co zrobić dalej. Nigdy
  ścieżki na dysku, stack trace'a ani treści błędu z ComfyUI.
- **Sekrety.** `ANTHROPIC_API_KEY` tylko po stronie serwera, `.env*`
  w `.gitignore`.

---

## 14. Testy

Zgodnie z `02-standardy-kodu`, rygor zbalansowany.

**Testujemy obowiązkowo:**
- kolejka: kolejność, anulowanie, timeout, zachowanie po restarcie
- budowanie ścieżek plików — z próbami wyjścia poza katalog danych
- dobieranie jakości w sharp do limitu wagi
- mapowanie briefu na parametry generowania
- walidacja limitu powierzchni obrazu
- każdy route handler: happy path i minimum dwa przypadki błędu
- każdy zgłoszony błąd: najpierw test odtwarzający, potem poprawka

**Nie testujemy:** że ComfyUI generuje obrazy, że FFmpeg konwertuje wideo,
że przycisk ma właściwy kolor.

**E2E (Playwright), maksymalnie 5:**
1. Nowe zlecenie → brief → generowanie → cztery warianty w galerii
2. Wybór wariantu → eksport → plik poniżej limitu wagi
3. Wgranie klipu → pętla → eksport MP4 i WebM
4. Anulowanie zadania w trakcie
5. ComfyUI niedostępne → czytelny komunikat, brak zawieszenia

---

## 15. Ryzyka

| Ryzyko | Wpływ | Reakcja |
|---|---|---|
| Seed nieodtwarzalny przez API ComfyUI | krytyczny | wykryty w E0, przed kodem |
| Mac zasypia w trakcie zadania | wysoki | `caffeinate`, ustawienia zasilania |
| darktable-cli nie znosi równoległych uruchomień | średni | serializacja w kolejce |
| Łącze w górę za wolne dla plików wideo | średni | grafik pobiera tylko eksporty, nie mastery |
| Jakość FLUX.2 klein niewystarczająca | **wysoki** | ocenić **przed** E1 |
| Mac jako pojedynczy punkt awarii | wysoki | świadomie zaakceptowany w wersji 1 |

**Ryzyko nierozstrzygnięte:** w chwili pisania tej specyfikacji nikt nie ocenił
jakości obrazów z FLUX.2 klein 4B na tej maszynie. Jeżeli okaże się
niewystarczająca dla materiałów Sygnara, zmienia się model — nie architektura,
bo workflow to plik JSON. Ale warto to wiedzieć przed E1, nie po E5.
