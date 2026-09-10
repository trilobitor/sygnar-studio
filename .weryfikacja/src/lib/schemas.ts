import { z } from 'zod'

import { JOB_KINDS, ORDER_INDUSTRIES, ORDER_STATUSES } from './enums'
import { MAX_GENERATION_PIXELS, PURPOSE_KEYS } from './output-presets'

/**
 * Schematy graniczne (SPEC §7). Jeden schemat = walidacja klienta i serwera,
 * typy przez `z.infer`, nigdy ręcznie dublowane interfejsy.
 */

export const orderIndustrySchema = z.enum(ORDER_INDUSTRIES)
export const orderStatusSchema = z.enum(ORDER_STATUSES)

export const createOrderSchema = z.object({
  name: z.string().min(2).max(120),
  industry: orderIndustrySchema.optional(),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

/** Zmiana nazwy zlecenia. Branży nie ruszamy — ta siedzi w nazwach plików. */
/**
 * Zmiana nazwy i branży zlecenia.
 *
 * Branży wcześniej nie dało się zmienić — komentarz twierdził, że „siedzi
 * w nazwach plików", ale nazwy powstają przy eksporcie, nie przy zakładaniu
 * zlecenia. Pomyłka przy zakładaniu oznaczała więc konieczność założenia
 * zlecenia od nowa. Pliki już oddane zachowują swoje nazwy; zmiana dotyczy
 * kolejnych.
 */
export const renameOrderSchema = z.object({
  name: z.string().min(2).max(120),
  industry: orderIndustrySchema.optional(),
  /**
   * Status zlecenia. Zmieniany osobno od nazwy, ale tym samym żądaniem —
   * archiwizowanie to jedna wartość, nie osobny czasownik w API.
   */
  status: orderStatusSchema.optional(),
})

export type RenameOrderInput = z.infer<typeof renameOrderSchema>

/**
 * Makieta briefu. Wymagany jest wyłącznie punkt pierwszy — reszta pusta
 * oznacza wartości domyślne, a aplikacja wypisuje jawnie, co uzupełniła.
 */
export const briefSchema = z.object({
  subject: z.string().min(3).max(500),
  purpose: z.enum(PURPOSE_KEYS),
  shot: z.enum(['closeup', 'medium', 'full', 'wide']).optional(),
  angle: z.enum(['eye', 'high', 'low', 'top']).optional(),
  timeOfDay: z.string().max(100).optional(),
  lighting: z.enum(['natural', 'studio', 'neon', 'candle', 'overcast']).optional(),
  place: z.string().max(300).optional(),
  mood: z.string().max(100).optional(),
  colors: z.string().max(150).optional(),
  style: z.enum(['photo', 'illustration', 'render3d', 'sketch', 'flat']).optional(),
  textOnImage: z.string().max(60).optional(),
  avoid: z.string().max(300).optional(),
  variants: z.number().int().min(1).max(8).default(4),
})

export type Brief = z.infer<typeof briefSchema>

/**
 * Wymiary generowania. Ograniczenie powierzchni jest walidowane po stronie
 * serwera, nie tylko w interfejsie — zmierzone w E0 zużycie pamięci przy
 * 2,08 Mpx to 27,81 GB przy 32 GB w maszynie.
 *
 * Pola i reguła stoją osobno, bo `.refine` zwraca `ZodEffects`, którego nie
 * da się rozszerzyć. Wcześniej ta sama reguła była wpisana dwa razy —
 * przy zmianie limitu jedna kopia zostałaby ze starą wartością.
 */
const dimensionFields = {
  width: z.number().int().min(256).max(2048).multipleOf(16),
  height: z.number().int().min(256).max(2048).multipleOf(16),
}

function mieściSięWLimicie(value: { width: number; height: number }): boolean {
  return value.width * value.height <= MAX_GENERATION_PIXELS
}

const LIMIT_POWIERZCHNI = {
  message: 'Ten kadr jest za duży dla stacji. Wybierz mniejszy format.',
  path: ['width'],
}

export const generateJobSchema = z.object({
  orderId: z.string().uuid(),
  promptEn: z.string().min(10).max(2000),
  ...dimensionFields,
  /*
   * Numery losowania podane wprost albo — gdy ich nie ma — wylosowane przez
   * serwer na podstawie `variants`.
   *
   * Losowanie robiła przeglądarka, w dwóch miejscach naraz, przez
   * `Math.random()`. Dwie kopie tej samej reguły rozjeżdżają się przy
   * pierwszej zmianie, a numer losowania jest jedyną rzeczą pozwalającą
   * odtworzyć kadr — nie powinien zależeć od tego, który przycisk kliknięto.
   */
  seeds: z.array(z.number().int().min(0).max(2_147_483_647)).min(1).max(8).optional(),
  /** Ile wariantów policzyć, gdy `seeds` nie podano. */
  variants: z.number().int().min(1).max(8).default(4),
  /** Klucz presetu — decyduje o skalowaniu i nazwie pliku przy eksporcie. */
  purpose: z.enum(PURPOSE_KEYS),
}).refine(mieściSięWLimicie, LIMIT_POWIERZCHNI)

export type GenerateJobInput = z.infer<typeof generateJobSchema>

/** Wynik warstwy promptowej. Walidowany zanim cokolwiek z niego użyjemy. */
export const promptResultSchema = z.object({
  // Opis sceny walidujemy twardo: bez niego nie ma czego generować.
  prompt_en: z.string().min(10).max(1500),
  /*
   * Założenia są dodatkiem, nie warunkiem powodzenia.
   *
   * `.max(3)` odrzucał **całą odpowiedź**, gdy model wypisał cztery założenia
   * — poprawny, gotowy opis lądował w koszu przez jedno zdanie komentarza za
   * dużo. Teraz nadmiar przycinamy, a nieparsowalną listę zastępujemy pustą.
   */
  assumptions: z
    .array(z.string().max(300))
    .catch([])
    .transform((lista) => lista.slice(0, 3))
    .default([]),
})

export type PromptResult = z.infer<typeof promptResultSchema>

export const jobKindSchema = z.enum(JOB_KINDS)

export const exportJobSchema = z.object({
  orderId: z.string().uuid(),
  assetId: z.string().uuid(),
  purpose: z.enum(PURPOSE_KEYS),
  /** Nadpisanie limitu wagi z presetu, gdy grafik chce inaczej. */
  maxWeightKb: z.number().int().min(10).max(2000).optional(),
})

export type ExportJobInput = z.infer<typeof exportJobSchema>

/**
 * Nazwy operacji montażu — wyprowadzone z unii, nie trzymane obok niej.
 *
 * Wcześniej stała tu osobna lista `['trim','loop','crop','poster','export']`,
 * nieodpowiadająca implementacji: `poster` i `export` nie są operacjami, tylko
 * skutkami ubocznymi montażu. Nikt tego enuma nie używał, więc rozjazd nie dał
 * o sobie znać — a właśnie dlatego jest groźny, bo wygląda na źródło prawdy.
 */
export const VIDEO_OPERATION_KINDS = ['trim', 'loop', 'crop'] as const
export type VideoOperationKind = (typeof VIDEO_OPERATION_KINDS)[number]

export const videoJobSchema = z.object({
  orderId: z.string().uuid(),
  assetId: z.string().uuid(),
  operations: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('trim'),
          startMs: z.number().int().min(0),
          endMs: z.number().int().min(1),
        }),
        z.object({ kind: z.literal('loop'), pingPong: z.boolean().default(true) }),
        z.object({
          kind: z.literal('crop'),
          aspect: z.enum(['vertical', 'square', 'horizontal']),
        }),
      ]),
    )
    .max(3)
    .default([]),
  /** Docelowa waga pliku wideo w megabajtach. */
  targetMb: z.number().min(0.5).max(50).default(4),
  poster: z.boolean().default(true),
})
  /*
   * Odwrócony zakres przycięcia przechodził walidację, a FFmpeg przerywał
   * kodem 23 — grafik dostawał komunikat o awarii montażu zamiast informacji,
   * że pomylił początek z końcem.
   *
   * Sprawdzenie stoi na całym zadaniu, nie na wariancie `trim`: Zod nie
   * przyjmuje `.refine` na członie unii rozróżnianej.
   */
  .refine(
    (job) =>
      job.operations.every((o) => o.kind !== 'trim' || o.endMs > o.startMs),
    {
      message: 'Koniec fragmentu musi być za jego początkiem.',
      path: ['operations'],
    },
  )

export type VideoJobInput = z.infer<typeof videoJobSchema>

/**
 * Pola formularza wgrywania poza samym plikiem.
 *
 * Handler sprawdzał wyłącznie `typeof orderId !== 'string'`, więc dowolny
 * napis szedł dalej do `getOrder` i dopiero baza zwracała 404. Reguła
 * z SPEC §13 mówi, że każde wejście przechodzi przez schemat — ta trasa była
 * jedynym wyjątkiem. Sam plik walidujemy sygnaturą, nie Zodem.
 */
export const uploadFormSchema = z.object({
  orderId: z.string().uuid(),
})

/**
 * Poprawka istniejącego kadru.
 *
 * Numer losowania jest opcjonalny: podany daje powtarzalny wynik, pominięty
 * każe serwerowi wylosować — tak samo jak przy generowaniu, bo przeglądarka
 * numerów nie losuje.
 */
export const imageEditSchema = z.object({
  orderId: z.string().uuid(),
  assetId: z.string().uuid(),
  /** Co ma wyjść inaczej. Reszta kadru ma zostać. */
  instructionEn: z.string().min(3).max(600),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
})

export type ImageEditInput = z.infer<typeof imageEditSchema>

/**
 * Przycięcie kadru.
 *
 * Prostokąt podawany w pikselach pliku źródłowego, nie w pikselach ekranu —
 * przeliczenie robi przeglądarka, bo tylko ona wie, w jakiej skali pokazuje
 * podgląd. Serwer sprawdza, czy prostokąt mieści się w obrazie.
 */
export const cropSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  // Sto pikseli to najmniejszy kadr, z którego cokolwiek da się wyeksportować:
  // najmniejszy slot w tabeli ma 624 px wysokości, a skalowanie w górę z mniej
  // niż stu pikseli daje papkę.
  width: z.number().int().min(100),
  height: z.number().int().min(100),
})

export type CropInput = z.infer<typeof cropSchema>

export const photoBatchSchema = z.object({
  orderId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1).max(200),
  presetXmpAssetId: z.string().uuid().optional(),
})

export type PhotoBatchInput = z.infer<typeof photoBatchSchema>
