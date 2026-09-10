/**
 * Presety wyjściowe — jedno źródło prawdy dla wymiarów, wagi i nazw plików
 * (decyzja D7, dane z briefu realizacyjnego §4.8).
 *
 * Każdy wpis niesie komplet, bo te trzy rzeczy zawsze chodzą razem:
 * co model ma wygenerować, co grafik ma dostać i ile to może ważyć.
 * Pole `purpose` w briefie jest kluczem tego obiektu, a enum Zod wywodzi się
 * z jego kluczy — jedna lista, nie dwie do rozjechania się.
 *
 * Wymiary generowania są wielokrotnością 16 i mieszczą się pod limitem
 * powierzchni. Wymiary dostarczane takiego ograniczenia nie mają, bo powstają
 * przez skalowanie (decyzja D6).
 */

/**
 * Twardy limit powierzchni generowania (SPEC §7).
 *
 * Zmierzone w E0 na tej maszynie: 1,11 Mpx → 17,95 GB szczytu pamięci,
 * 2,08 Mpx → 27,81 GB przy 32 GB w maszynie. Ten limit jest realnie
 * granicą pamięci, nie jakości — model przy 2,08 Mpx nie dublował elementów.
 * `--vae-tiling` nie zbija szczytu, sprawdzone.
 */
export const MAX_GENERATION_PIXELS = 2_100_000

export interface OutputPreset {
  /** Etykieta dla grafika. Po polsku, bez żargonu. */
  readonly label: string
  /** Opis w dymku — co ten preset realnie robi. */
  readonly hint: string
  /** Co dostaje model. Obie wartości wielokrotnością 16. */
  readonly generate: { readonly width: number; readonly height: number }
  /** Co dostaje grafik po skalowaniu i eksporcie. */
  readonly deliver: { readonly width: number; readonly height: number }
  /** Limit wagi pojedynczego pliku w kilobajtach. */
  readonly maxWeightKb: number
  /** Formaty eksportu w kolejności, w jakiej powstają. */
  readonly formats: readonly ('avif' | 'webp' | 'png' | 'jpeg')[]
  /** Człon nazwy pliku: `<branza>-<slot>-<nr>.<ext>`. */
  readonly slug: string
  /** Czy preset pochodzi z briefu sygnar.pl, czy jest ogólny pod zlecenia. */
  readonly source: 'sygnar' | 'generic'
}

export const OUTPUT_PRESETS = {
  'services-wide': {
    label: 'Usługa, kadr poziomy',
    hint: 'Szeroki kadr na kartę usługi. Temat trzymaj w środkowym pasie.',
    generate: { width: 1664, height: 1248 },
    deliver: { width: 2000, height: 1500 },
    maxWeightKb: 180,
    formats: ['avif', 'webp'],
    slug: 'services',
    source: 'sygnar',
  },
  'services-tall': {
    label: 'Usługa, kadr pionowy',
    hint: 'Pionowa karta usługi. Generowany od razu w docelowym wymiarze.',
    generate: { width: 1200, height: 1600 },
    deliver: { width: 1200, height: 1600 },
    maxWeightKb: 180,
    formats: ['avif', 'webp'],
    slug: 'services-tall',
    source: 'sygnar',
  },
  case: {
    label: 'Realizacja',
    hint: 'Kadr do opisu realizacji. Wnętrze, architektura albo detal.',
    generate: { width: 1792, height: 1120 },
    deliver: { width: 1800, height: 1125 },
    maxWeightKb: 160,
    formats: ['avif', 'webp'],
    slug: 'case',
    source: 'sygnar',
  },
  'video-poster': {
    label: 'Plansza wideo',
    hint: 'Nieruchomy kadr pokazywany, zanim ruszy film.',
    generate: { width: 1920, height: 1088 },
    deliver: { width: 1920, height: 1080 },
    maxWeightKb: 200,
    formats: ['avif', 'webp'],
    slug: 'video-poster',
    source: 'sygnar',
  },
  'hero-showcase': {
    label: 'Kadr otwierający',
    hint: 'Największy kadr na stronie. Najdłuższy do policzenia.',
    generate: { width: 1920, height: 1088 },
    deliver: { width: 2400, height: 1350 },
    maxWeightKb: 220,
    formats: ['avif', 'webp'],
    slug: 'hero',
    source: 'sygnar',
  },
  og: {
    label: 'Miniatura do udostępnień',
    hint: 'To widać, gdy ktoś wkleja link na Facebooku albo LinkedIn.',
    generate: { width: 1200, height: 624 },
    deliver: { width: 1200, height: 630 },
    maxWeightKb: 300,
    // Brief §4.8 przewiduje tu PNG, ale zmierzone kadry fotograficzne wychodzą
    // w PNG na 353–545 KB przy limicie 300 KB — slot był martwy dla każdego
    // zdjęcia. JPEG mieści się z zapasem i jest obsługiwany przez wszystkie
    // podglądy odnośników. Odstępstwo od briefu opisane w DECYZJE.md D16.
    formats: ['jpeg'],
    slug: 'og',
    source: 'sygnar',
  },
  portrait: {
    label: 'Portret',
    hint: 'Kwadrat pod zdjęcie osoby. Twarz w środkowym pasie kadru.',
    generate: { width: 1024, height: 1024 },
    deliver: { width: 800, height: 800 },
    maxWeightKb: 60,
    formats: ['webp'],
    slug: 'portrait',
    source: 'sygnar',
  },
  square: {
    label: 'Kwadrat',
    hint: 'Uniwersalny kwadrat pod social i zlecenia klienckie.',
    generate: { width: 1024, height: 1024 },
    deliver: { width: 1024, height: 1024 },
    maxWeightKb: 180,
    formats: ['avif', 'webp'],
    slug: 'square',
    source: 'generic',
  },
  story: {
    label: 'Pionowy pod telefon',
    hint: 'Format relacji na Instagramie i podobnych.',
    generate: { width: 832, height: 1472 },
    deliver: { width: 1080, height: 1920 },
    maxWeightKb: 200,
    formats: ['avif', 'webp'],
    slug: 'story',
    source: 'generic',
  },
  texture: {
    label: 'Tło i tekstura',
    hint: 'Materiał do podłożenia pod tekst. Bez wyraźnego tematu w kadrze.',
    generate: { width: 1024, height: 1024 },
    deliver: { width: 1024, height: 1024 },
    maxWeightKb: 120,
    formats: ['avif', 'webp'],
    slug: 'texture',
    source: 'generic',
  },
} as const satisfies Record<string, OutputPreset>

export type PurposeKey = keyof typeof OUTPUT_PRESETS

export const PURPOSE_KEYS = Object.keys(OUTPUT_PRESETS) as [PurposeKey, ...PurposeKey[]]

export function getPreset(purpose: PurposeKey): OutputPreset {
  return OUTPUT_PRESETS[purpose]
}

/** Ile razy trzeba powiększyć kadr, żeby z generowanego zrobić dostarczany. */
/**
 * Ile razy trzeba powiększyć kadr, żeby wypełnił slot.
 *
 * Liczone z **obu wymiarów**, nie z samej szerokości. Przy slocie o innych
 * proporcjach niż kadr decyduje ten wymiar, który wymaga większego
 * powiększenia — inaczej liczba mówiła „1,0×" dla przypadku, w którym wysokość
 * rosła dwukrotnie. Skalowanie i tak działa przez `fit: cover`, więc to ta
 * większa wartość opisuje faktyczną utratę ostrości.
 */
export function upscaleFactor(purpose: PurposeKey): number {
  const preset = OUTPUT_PRESETS[purpose]

  return Math.max(
    preset.deliver.width / preset.generate.width,
    preset.deliver.height / preset.generate.height,
  )
}
