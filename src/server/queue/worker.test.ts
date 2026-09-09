import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/server/db/client'
import { assets, briefs, jobs, orders } from '@/server/db/schema'
import { enqueue, getJob } from './store'
import { cancelJob, registerRunner, tick } from './worker'
import { randomUUID } from 'node:crypto'

/**
 * Testy workera dopisane po audycie (#54). Komentarz w kodzie twierdził, że
 * anulowanie i przekroczenie czasu są obsłużone, ale nie było ani jednej
 * asercji — a jedna z tych ścieżek była wprost zepsuta: runner, który nie
 * pilnuje sygnału, wracał normalnie i zadanie meldowało się jako „Gotowe".
 */

function zlecenie(): string {
  const id = randomUUID()
  db.insert(orders)
    .values({
      id,
      name: 'Test workera',
      industry: 'other',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run()
  return id
}

async function poczekajNaStatus(id: string, docelowe: string[], msMax = 5000): Promise<string> {
  const koniec = Date.now() + msMax

  while (Date.now() < koniec) {
    const stan = getJob(id)?.status ?? '?'
    if (docelowe.includes(stan)) return stan
    await new Promise((r) => setTimeout(r, 25))
  }

  return getJob(id)?.status ?? '?'
}

beforeEach(() => {
  db.delete(assets).run()
  db.delete(briefs).run()
  db.delete(jobs).run()
  db.delete(orders).run()
})

describe('worker: anulowanie', () => {
  it('runner ignorujący sygnał nie kończy się statusem „Gotowe"', async () => {
    // Sedno usterki. Eksport przez sharpa nie sprawdza `ctx.signal` wcale,
    // więc wracał normalnie mimo anulowania, a worker stawiał `done`.
    registerRunner('image_export', async () => {
      await new Promise((r) => setTimeout(r, 150))
      // Świadomie **bez** sprawdzenia sygnału.
    })

    const job = enqueue({
      orderId: zlecenie(),
      kind: 'image_export',
      params: { udawane: true },
    })

    void tick()
    await new Promise((r) => setTimeout(r, 40))

    expect(cancelJob(job.id)).toBe(true)

    const stan = await poczekajNaStatus(job.id, ['cancelled', 'done', 'failed'])
    expect(stan).toBe('cancelled')
  })

  it('anulowanie zadania, którego jeszcze nie zaczęto, też działa', async () => {
    registerRunner('image_export', async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    const job = enqueue({ orderId: zlecenie(), kind: 'image_export', params: {} })

    expect(cancelJob(job.id)).toBe(true)
    expect(await poczekajNaStatus(job.id, ['cancelled'])).toBe('cancelled')
  })

  it('anulowanie nieistniejącego zadania nie wywraca się', () => {
    expect(cancelJob(randomUUID())).toBe(false)
  })
})

describe('worker: błąd runnera', () => {
  it('wyjątek kończy zadanie jako nieudane, z kodem', async () => {
    registerRunner('image_export', async () => {
      await Promise.resolve()
      throw new Error('coś poszło nie tak')
    })

    const job = enqueue({ orderId: zlecenie(), kind: 'image_export', params: {} })

    void tick()

    expect(await poczekajNaStatus(job.id, ['failed', 'done'])).toBe('failed')
    expect(getJob(job.id)?.errorCode).not.toBeNull()
  })

  it('runner kończący się normalnie daje „Gotowe"', async () => {
    // Kontrola: bez tego test anulowania przechodziłby także wtedy, gdyby
    // worker oznaczał wszystko jako anulowane.
    registerRunner('image_export', async () => {
      await Promise.resolve()
    })

    const job = enqueue({ orderId: zlecenie(), kind: 'image_export', params: {} })

    void tick()

    expect(await poczekajNaStatus(job.id, ['done', 'failed', 'cancelled'])).toBe('done')
  })
})
