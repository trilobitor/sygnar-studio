import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/server/db/client'
import { jobs, orders } from '@/server/db/schema'
import {
  countRunning,
  enqueue,
  failInterruptedJobs,
  getJob,
  GPU_JOB_KINDS,
  isGpuJob,
  listQueued,
  markCancelled,
  markDone,
  markFailed,
  markRunning,
  positionInQueue,
  updateProgress,
} from './store'

/**
 * Kolejka jest testem obowiązkowym (SPEC §14): kolejność, anulowanie,
 * zachowanie po restarcie. Timeout żyje w workerze i jest sprawdzany osobno.
 */

function makeOrder(): string {
  const id = randomUUID()
  const now = Date.now()
  db.insert(orders)
    .values({ id, name: 'Zlecenie testowe', industry: 'legal', status: 'draft', createdAt: now, updatedAt: now })
    .run()
  return id
}

let orderId = ''

beforeEach(() => {
  // Czyścimy zadania między testami, żeby kolejność była przewidywalna.
  db.delete(jobs).run()
  orderId = makeOrder()
})

describe('podział na pule', () => {
  it('generowanie i wideo idą przez GPU', () => {
    expect(isGpuJob('image_generate')).toBe(true)
    expect(isGpuJob('video_render')).toBe(true)
    expect(GPU_JOB_KINDS).toHaveLength(2)
  })

  it('eksport i wsad zdjęć nie zajmują GPU', () => {
    expect(isGpuJob('image_export')).toBe(false)
    expect(isGpuJob('photo_batch')).toBe(false)
  })
})

describe('kolejność', () => {
  it('wydaje zadania od najstarszego', () => {
    const first = enqueue({ orderId, kind: 'image_generate', params: { a: 1 } })
    const second = enqueue({ orderId, kind: 'image_generate', params: { a: 2 } })

    // `createdAt` ma rozdzielczość milisekundy, więc rozsuwamy je ręcznie.
    db.update(jobs).set({ createdAt: 1000 }).where(eqId(first.id)).run()
    db.update(jobs).set({ createdAt: 2000 }).where(eqId(second.id)).run()

    const queued = listQueued()
    expect(queued[0]?.id).toBe(first.id)
    expect(queued[1]?.id).toBe(second.id)
  })

  it('liczy, ile zadań czeka przed danym', () => {
    const first = enqueue({ orderId, kind: 'image_generate', params: {} })
    const second = enqueue({ orderId, kind: 'image_generate', params: {} })

    db.update(jobs).set({ createdAt: 1000 }).where(eqId(first.id)).run()
    db.update(jobs).set({ createdAt: 2000 }).where(eqId(second.id)).run()

    const reloaded = getJob(second.id)
    if (reloaded === undefined) throw new Error('zadanie zniknęło z bazy')
    expect(positionInQueue(reloaded)).toBe(1)
  })

  it('nowe zadanie startuje jako oczekujące z zerowym postępem', () => {
    const job = enqueue({ orderId, kind: 'image_generate', params: {} })
    expect(job.status).toBe('queued')
    expect(job.progress).toBe(0)
    expect(job.phase).toBe('W kolejce')
  })
})

describe('przejścia stanów', () => {
  it('zapisuje postęp i przycina go do zakresu 0–1', () => {
    const job = enqueue({ orderId, kind: 'image_generate', params: {} })
    markRunning(job.id)

    updateProgress(job.id, 1.7, 'Rysuję kadr')
    expect(getJob(job.id)?.progress).toBe(1)

    updateProgress(job.id, -0.5, 'Rysuję kadr')
    expect(getJob(job.id)?.progress).toBe(0)
  })

  it('zakończone zadanie ma pełny postęp i czas zakończenia', () => {
    const job = enqueue({ orderId, kind: 'image_generate', params: {} })
    markRunning(job.id)
    markDone(job.id)

    const done = getJob(job.id)
    expect(done?.status).toBe('done')
    expect(done?.progress).toBe(1)
    expect(done?.finishedAt).not.toBeNull()
  })

  it('anulowane zadanie dostaje kod JOB_CANCELLED', () => {
    const job = enqueue({ orderId, kind: 'image_generate', params: {} })
    markCancelled(job.id)

    const cancelled = getJob(job.id)
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.errorCode).toBe('JOB_CANCELLED')
  })

  it('nieudane zadanie niesie kod, nie treść błędu', () => {
    const job = enqueue({ orderId, kind: 'image_generate', params: {} })
    markFailed(job.id, 'OUT_OF_MEMORY')

    const failed = getJob(job.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.errorCode).toBe('OUT_OF_MEMORY')
    expect(failed?.phase).toBeNull()
  })

  it('liczy zadania biegnące w danej puli', () => {
    const first = enqueue({ orderId, kind: 'image_generate', params: {} })
    enqueue({ orderId, kind: 'image_export', params: {} })
    markRunning(first.id)

    expect(countRunning(GPU_JOB_KINDS)).toBe(1)
    expect(countRunning(['image_export'])).toBe(0)
  })
})

describe('zachowanie po restarcie', () => {
  it('oznacza zastane zadania jako przerwane restartem', () => {
    const running = enqueue({ orderId, kind: 'image_generate', params: {} })
    const waiting = enqueue({ orderId, kind: 'image_generate', params: {} })
    markRunning(running.id)

    const count = failInterruptedJobs()

    expect(count).toBe(1)
    expect(getJob(running.id)?.errorCode).toBe('INTERRUPTED_BY_RESTART')
    expect(getJob(running.id)?.status).toBe('failed')
    // Zadanie czekające restart przetrwało i dalej czeka.
    expect(getJob(waiting.id)?.status).toBe('queued')
  })

  it('nie rusza zadań już zakończonych', () => {
    const job = enqueue({ orderId, kind: 'image_generate', params: {} })
    markRunning(job.id)
    markDone(job.id)

    expect(failInterruptedJobs()).toBe(0)
    expect(getJob(job.id)?.status).toBe('done')
  })
})

/** Pomocnik na warunek po identyfikatorze — trzymany blisko testów. */
function eqId(id: string) {
  return eq(jobs.id, id)
}
