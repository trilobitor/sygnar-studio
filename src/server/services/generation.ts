import { generateJobSchema, type GenerateJobInput } from '@/lib/schemas'
import { generate } from '@/server/adapters/mflux'
import { JobError, type JobContext } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { webcrypto } from 'node:crypto'

import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'
import { registerAsset } from './assets'
import { touchOrder } from './orders'

/**
 * Generowanie obrazów: wstawienie zadania do kolejki i jego wykonanie.
 * Warstwa serwisów nie importuje niczego z `next/*`.
 */

/**
 * Numery losowania z generatora kryptograficznego.
 *
 * `Math.random()` w przeglądarce wystarczał, ale reguła siedziała w dwóch
 * miejscach interfejsu naraz — a numer losowania jest jedyną rzeczą
 * pozwalającą odtworzyć kadr co do piksela.
 */
export function losujSeedy(ile: number): number[] {
  const bufor = new Uint32Array(ile)
  webcrypto.getRandomValues(bufor)

  // mflux przyjmuje liczby do 2^31-1, więc obcinamy górny bit.
  return [...bufor].map((n) => n % 2_147_483_647)
}

export function enqueueGeneration(input: GenerateJobInput): Job {
  // Numery losuje serwer, jeśli klient ich nie podał — jedna reguła zamiast
  // dwóch kopii w interfejsie.
  const params = {
    ...input,
    seeds: input.seeds ?? losujSeedy(input.variants),
  }

  const job = enqueue({ orderId: input.orderId, kind: 'image_generate', params })
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
      // Zadanie w bazie zawsze ma już wylosowane numery — `enqueueGeneration`
      // uzupełnia je przed zapisem. Zapas na wypadek wiersza sprzed zmiany.
      seeds: params.seeds ?? losujSeedy(params.variants),
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
