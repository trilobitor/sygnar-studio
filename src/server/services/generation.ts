import { generateJobSchema, type GenerateJobInput } from '@/lib/schemas'
import { generate } from '@/server/adapters/mflux'
import { JobError, type JobContext } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'
import { registerAsset } from './assets'
import { touchOrder } from './orders'

/**
 * Generowanie obrazów: wstawienie zadania do kolejki i jego wykonanie.
 * Warstwa serwisów nie importuje niczego z `next/*`.
 */

export function enqueueGeneration(input: GenerateJobInput): Job {
  const job = enqueue({ orderId: input.orderId, kind: 'image_generate', params: input })
  touchOrder(input.orderId, 'active')
  void tick()
  return job
}

async function runGeneration(job: Job, ctx: JobContext): Promise<void> {
  // Parametry zapisane w bazie też przechodzą przez schemat — baza jest
  // granicą jak każda inna, a JSON mógł tam trafić z wcześniejszej wersji.
  const parsed = generateJobSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'parametry zadania nie przeszły walidacji')
  }

  const params = parsed.data

  ctx.onProgress({ percent: 0, phase: 'Przygotowuję stację' })

  const images = await generate(
    {
      promptEn: params.promptEn,
      width: params.width,
      height: params.height,
      seeds: params.seeds,
    },
    ctx,
  )

  ctx.onProgress({ percent: 1, phase: 'Zapisuję kadry' })

  for (const image of images) {
    await registerAsset({
      orderId: job.orderId,
      jobId: job.id,
      kind: 'generated',
      absolutePath: image.path,
      mime: 'image/png',
      width: image.width,
      height: image.height,
      seed: image.seed,
      metadata: { purpose: params.purpose, promptEn: params.promptEn, mflux: image.metadata },
    })
  }

  ctx.logger.info('zapisano kadry', { count: images.length })
  touchOrder(job.orderId)
}

registerRunner('image_generate', runGeneration)
