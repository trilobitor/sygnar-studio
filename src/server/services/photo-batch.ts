import { join } from 'node:path'

import { env, hasDarktable } from '@/lib/env'
import { applyPreset } from '@/server/adapters/darktable'
import { readDimensions } from '@/server/adapters/sharp'
import { JobError, type JobContext } from '@/server/adapters/types'
import { photoBatchSchema, type PhotoBatchInput } from '@/lib/schemas'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'
import { assetFilePath, getAsset, registerAsset } from './assets'
import { getOrder, touchOrder } from './orders'
import { bucketDir, buildOutputName } from './paths'

/**
 * Wsadowa obróbka zdjęć presetem darktable (SPEC §6, etap E6).
 *
 * [NIEPOTWIERDZONE] darktable prawdopodobnie nie znosi równoległych uruchomień
 * przez blokadę biblioteki. Do czasu weryfikacji wywołania idą jedno po drugim
 * wewnątrz zadania, więc równoległość nie powstaje nawet przypadkiem.
 */

export function enqueuePhotoBatch(input: PhotoBatchInput): Job {
  const job = enqueue({ orderId: input.orderId, kind: 'photo_batch', params: input })
  void tick()
  return job
}

async function runPhotoBatch(job: Job, ctx: JobContext): Promise<void> {
  if (!hasDarktable) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'darktable nie jest skonfigurowany')
  }

  const parsed = photoBatchSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'parametry wsadu nie przeszły walidacji')
  }

  const params = parsed.data
  const outputDir = bucketDir(env.STUDIO_DATA_DIR, params.orderId, 'exports')

  const presetPath =
    params.presetXmpAssetId === undefined
      ? null
      : assetFilePath(getAsset(params.presetXmpAssetId))

  const order = getOrder(params.orderId)

  /*
   * Numerację prowadzimy przez cały wsad, żeby pliki wyszły jako
   * `<branza>-zdjecia-01.jpg`, `-02`, `-03`. Wcześniej nazwą był identyfikator
   * zasobu — dla grafika, który te pliki oddaje klientowi, taka nazwa nie
   * niesie żadnej informacji, a przy dwustu zdjęciach nie da się ich odróżnić.
   */
  let done = 0

  for (const assetId of params.assetIds) {
    if (ctx.signal.aborted) {
      throw new JobError('JOB_CANCELLED', 'zadanie anulowane')
    }

    const source = getAsset(assetId)
    const sourcePath = assetFilePath(source)
    const outputPath = join(
      outputDir,
      buildOutputName({
        industry: order.industry,
        slug: 'zdjecia',
        index: done + 1,
        extension: 'jpg',
      }),
    )

    await applyPreset({ sourcePath, presetPath, outputPath }, ctx)

    /*
     * Wymiary czytamy z gotowego pliku. Bez nich kontrola przed oddaniem nie
     * ma czego sprawdzić, a panel „Do oddania" pokazuje puste miejsce zamiast
     * rozmiaru — sprawdzone na pierwszym prawdziwym przebiegu wsadu.
     */
    const wymiary = await readDimensions(outputPath)

    await registerAsset({
      orderId: params.orderId,
      jobId: job.id,
      kind: 'export',
      absolutePath: outputPath,
      mime: 'image/jpeg',
      width: wymiary?.width,
      height: wymiary?.height,
      metadata: {
        sourceAssetId: source.id,
        preset: params.presetXmpAssetId ?? null,
        hasAlpha: wymiary?.hasAlpha ?? false,
      },
    })

    done += 1
    ctx.onProgress({
      percent: done / params.assetIds.length,
      phase: `Obrabiam zdjęcie ${done} z ${params.assetIds.length}`,
    })
  }

  touchOrder(params.orderId)
}

registerRunner('photo_batch', runPhotoBatch)
