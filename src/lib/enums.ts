/**
 * Listy dopuszczalnych wartości — jedno źródło dla schematów granicznych
 * i dla schematu bazy.
 *
 * Wcześniej te same wartości stały w dwóch plikach naraz: `lib/schemas.ts`
 * miało je jako `z.enum`, a `server/db/schema.ts` jako krotki dla Drizzle.
 * Dopisanie statusu w jednym miejscu nie dawało żadnego sygnału o drugim.
 * Krotki muszą zostać krotkami (`as const`), bo Drizzle nie przyjmuje
 * zwykłej tablicy napisów.
 */

export const ORDER_STATUSES = ['draft', 'active', 'done', 'archived'] as const
export const ORDER_INDUSTRIES = ['legal', 'medical', 'estate', 'build', 'other'] as const
export const JOB_KINDS = [
  'image_generate',
  'image_edit',
  /*
   * Generowanie klipu z opisu (Wan 2.2 TI2V-5B przez FastVideo/MLX).
   *
   * Osobny rodzaj od `video_render`, który jest montażem FFmpeg trwającym
   * sekundy. Generowanie liczy się minutami i zajmuje GPU, więc dzielenie
   * z montażem jednego klucza zepsułoby pulę, limit czasu i komunikaty.
   */
  'video_generate',
  'video_render',
  'image_export',
  'photo_batch',
] as const
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export const ASSET_KINDS = ['generated', 'uploaded', 'export', 'poster'] as const
