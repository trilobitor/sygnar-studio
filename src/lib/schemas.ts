import { z } from 'zod'

import { MAX_GENERATION_PIXELS, PURPOSE_KEYS } from './output-presets'

/**
 * Schematy graniczne (SPEC §7). Jeden schemat = walidacja klienta i serwera,
 * typy przez `z.infer`, nigdy ręcznie dublowane interfejsy.
 */

export const orderIndustrySchema = z.enum(['legal', 'medical', 'estate', 'build', 'other'])
export const orderStatusSchema = z.enum(['draft', 'active', 'done', 'archived'])

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
 */
export const dimensionsSchema = z
  .object({
    width: z.number().int().min(256).max(2048).multipleOf(16),
    height: z.number().int().min(256).max(2048).multipleOf(16),
  })
  .refine((value) => value.width * value.height <= MAX_GENERATION_PIXELS, {
    message: 'Ten kadr jest za duży dla stacji. Wybierz mniejszy format.',
    path: ['width'],
  })

export const generateJobSchema = z.object({
  orderId: z.string().uuid(),
  promptEn: z.string().min(10).max(2000),
  width: z.number().int().min(256).max(2048).multipleOf(16),
  height: z.number().int().min(256).max(2048).multipleOf(16),
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
})
  .refine((value) => value.width * value.height <= MAX_GENERATION_PIXELS, {
    message: 'Ten kadr jest za duży dla stacji. Wybierz mniejszy format.',
    path: ['width'],
  })

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

export const jobKindSchema = z.enum([
  'image_generate',
  'video_render',
  'image_export',
  'photo_batch',
])

export const exportJobSchema = z.object({
  orderId: z.string().uuid(),
  assetId: z.string().uuid(),
  purpose: z.enum(PURPOSE_KEYS),
  /** Nadpisanie limitu wagi z presetu, gdy grafik chce inaczej. */
  maxWeightKb: z.number().int().min(10).max(2000).optional(),
})

export type ExportJobInput = z.infer<typeof exportJobSchema>

export const videoOperationSchema = z.enum(['trim', 'loop', 'crop', 'poster', 'export'])

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

export const photoBatchSchema = z.object({
  orderId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1).max(200),
  presetXmpAssetId: z.string().uuid().optional(),
})

export type PhotoBatchInput = z.infer<typeof photoBatchSchema>
