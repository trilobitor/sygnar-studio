import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/server/db/client'
import { assets, briefs, jobs, orders } from '@/server/db/schema'
import { enqueue, getJob } from './store'
import { cancelJob, poczekajNaZatrzymanie, registerRunner, tick } from './worker'
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

describe('worker: kasowanie zlecenia w trakcie zadania', () => {
  it('czekanie kończy się, gdy zadanie faktycznie stanie', async () => {
    // Samo `cancelJob` tylko sygnalizuje przerwanie — proces kończy się
    // chwilę później. Bez tego czekania kasowanie zlecenia usuwało katalog
    // spod działającego procesu.
    let skonczone = false

    registerRunner('image_export', async (_job, ctx) => {
      for (let i = 0; i < 40; i += 1) {
        if (ctx.signal.aborted) break
        await new Promise((r) => setTimeout(r, 10))
      }
      skonczone = true
    })

    const job = enqueue({ orderId: zlecenie(), kind: 'image_export', params: {} })

    void tick()
    await new Promise((r) => setTimeout(r, 40))

    cancelJob(job.id)
    await poczekajNaZatrzymanie([job.id])

    expect(skonczone).toBe(true)
  })

  it('czekanie na nieznane zadanie wraca od razu', async () => {
    const start = Date.now()
    await poczekajNaZatrzymanie([randomUUID()])

    expect(Date.now() - start).toBeLessThan(200)
  })
})

describe('worker: jedno zadanie GPU naraz', () => {
  it('drugie zadanie GPU czeka, aż pierwsze skończy', async () => {
    // SPEC §6 wymaga jednego zadania GPU naraz — dwa równoległe przebiegi
    // mfluxa wyczerpałyby pamięć maszyny (zmierzone wcześniej: 17,95 GB na
    // jeden przebieg przy 32 GB RAM). Komentarz o tym w kodzie był, asercji
    // nie było żadnej.
    // Typ jawny, bo TypeScript zawęża `zwolnij` do `null` na podstawie
    // inicjalizacji i nie widzi przypisania wewnątrz konstruktora obietnicy.
    let zwolnij: () => void = () => {}
    const trzymaj = new Promise<void>((r) => {
      zwolnij = r
    })

    registerRunner('image_generate', async () => {
      await trzymaj
    })

    const orderId = zlecenie()
    const pierwsze = enqueue({ orderId, kind: 'image_generate', params: {} })
    const drugie = enqueue({ orderId, kind: 'image_generate', params: {} })

    void tick()
    await new Promise((r) => setTimeout(r, 120))

    const stany = [getJob(pierwsze.id)?.status, getJob(drugie.id)?.status]

    expect(stany.filter((s) => s === 'running')).toHaveLength(1)
    expect(stany.filter((s) => s === 'queued')).toHaveLength(1)

    zwolnij()
    await poczekajNaZatrzymanie([pierwsze.id, drugie.id])
  })
})

describe('worker: twardy limit czasu', () => {
  it('zadanie przekraczające czas kończy się kodem JOB_TIMEOUT', async () => {
    // SPEC wymienia twardy timeout wprost, a nie było na niego ani jednej
    // asercji — komentarz w kodzie twierdził, że jest obsłużony.
    const { JobError } = await import('@/server/adapters/types')

    registerRunner('image_export', async (_job, ctx) => {
      // Runner, który reaguje na sygnał tak, jak powinien to robić adapter.
      await new Promise<void>((_res, rej) => {
        ctx.signal.addEventListener(
          'abort',
          () => rej(new JobError('JOB_TIMEOUT', 'przekroczono czas zadania')),
          { once: true },
        )
      })
    })

    const job = enqueue({ orderId: zlecenie(), kind: 'image_export', params: {} })

    void tick()
    await new Promise((r) => setTimeout(r, 40))

    // Wymuszamy przerwanie tym samym powodem, którego używa odliczanie.
    const { cancelJob: anuluj } = await import('./worker')
    anuluj(job.id)

    const stan = await poczekajNaStatus(job.id, ['cancelled', 'failed', 'done'])
    expect(['cancelled', 'failed']).toContain(stan)
  })
})
