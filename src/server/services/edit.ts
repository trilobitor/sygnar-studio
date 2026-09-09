import { imageEditSchema, type ImageEditInput } from '@/lib/schemas'
import { editImage } from '@/server/adapters/mflux'
import { readDimensions } from '@/server/adapters/sharp'
import { ApiError, JobError, type JobContext } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'

import { assetFilePath, getAsset, registerAsset } from './assets'
import { losujSeedy } from './generation'
import { touchOrder } from './orders'

/**
 * Poprawianie istniejącego kadru.
 *
 * Różnica wobec „ten sam numer, nowy opis": tam kadr powstaje **od zera** z
 * poprawionego opisu i wychodzi inny, choćby zmiana była drobna. Tutaj model
 * dostaje gotowy kadr i zdanie mówiące, co ma być inaczej — reszta zostaje.
 * Zmierzone: zmiana koloru nieba na plakacie zostawiła wieżę, roboty, tłum
 * i psa bez zmian.
 *
 * Warstwa serwisów nie importuje niczego z `next/*`.
 */

export function enqueueEdit(input: ImageEditInput): Job {
  // Kadr musi istnieć i należeć do tego zlecenia — sprawdzane przed kolejką,
  // żeby błąd wrócił od razu, a nie po odczekaniu swojego w kolejce.
  const source = getAsset(input.assetId)

  if (source.orderId !== input.orderId) {
    throw new ApiError('NOT_FOUND', 'kadr nie należy do tego zlecenia', 404)
  }

  if (source.mime.startsWith('video/')) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'poprawiać można kadr, nie klip')
  }

  const job = enqueue({ orderId: input.orderId, kind: 'image_edit', params: input })
  void tick()
  return job
}

async function runEdit(job: Job, ctx: JobContext): Promise<void> {
  const parsed = imageEditSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'parametry poprawki nie przeszły walidacji')
  }

  const params = parsed.data
  const source = getAsset(params.assetId)

  // Numer losowania dobiera serwer, gdy klient go nie podał — ta sama reguła
  // co przy generowaniu i w jednym miejscu, nie w dwóch.
  const seed = params.seed ?? losujSeedy(1)[0] ?? 0

  ctx.onProgress({ percent: 0, phase: 'Przygotowuję' })

  const wynik = await editImage(
    {
      sourcePath: assetFilePath(source),
      instructionEn: params.instructionEn,
      seed,
      width: source.width ?? 0,
      height: source.height ?? 0,
    },
    ctx,
  )

  // Wymiary czytamy z gotowego pliku, a nie przepisujemy z kadru źródłowego:
  // model bywa, że zwraca inny rozmiar, a zła liczba w bazie psuje kontrolę
  // przed oddaniem.
  const wymiary = await readDimensions(wynik.path)

  ctx.onProgress({ percent: 1, phase: 'Zapisuję kadr' })

  await registerAsset({
    orderId: params.orderId,
    jobId: job.id,
    kind: 'generated',
    absolutePath: wynik.path,
    mime: 'image/png',
    width: wymiary?.width,
    height: wymiary?.height,
    seed,
    metadata: {
      // Ślad pochodzenia: z którego kadru i po jakiej instrukcji to powstało.
      poprawkaZ: source.id,
      instructionEn: params.instructionEn,
      hasAlpha: wymiary?.hasAlpha ?? false,
      mflux: wynik.metadata,
    },
  })

  touchOrder(params.orderId)
}

registerRunner('image_edit', runEdit)
