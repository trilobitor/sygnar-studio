import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/server/db/client'
import { assets, jobs, orders, promptRuns, type Job } from '@/server/db/schema'

import { summarizeOrder } from './orders'

/**
 * Agregat do wyceny zlecenia.
 *
 * `prompt_runs` i znaczniki czasu zadań były zapisywane od początku i nigdy
 * nieczytane — te testy pilnują, żeby liczby się zgadzały, a nie żeby wywołanie
 * po prostu nie rzuciło wyjątku.
 */

const ZLECENIE = '33333333-3333-4333-8333-333333333333'
const INNE = '44444444-4444-4444-8444-444444444444'

function zlecenie(id: string): void {
  db.insert(orders)
    .values({ id, name: `Zlecenie ${id.slice(0, 4)}`, industry: 'legal', status: 'active', createdAt: 1, updatedAt: 1 })
    .run()
}

function plik(orderId: string, kind: 'generated' | 'export' | 'poster' | 'uploaded'): void {
  db.insert(assets)
    .values({
      id: randomUUID(),
      orderId,
      kind,
      path: `${kind}.png`,
      mime: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      seed: null,
      metadataJson: '{}',
      createdAt: 1,
    })
    .run()
}

function zadanie(
  orderId: string,
  kind: Job['kind'],
  start: number | null,
  koniec: number | null,
): void {
  db.insert(jobs)
    .values({
      id: randomUUID(),
      orderId,
      kind,
      status: 'done',
      paramsJson: '{}',
      errorCode: null,
      startedAt: start,
      finishedAt: koniec,
      createdAt: 1,
    })
    .run()
}

beforeEach(() => {
  db.delete(promptRuns).run()
  db.delete(assets).run()
  db.delete(jobs).run()
  db.delete(orders).run()
  zlecenie(ZLECENIE)
  zlecenie(INNE)
})

describe('podsumowanie zlecenia', () => {
  it('puste zlecenie daje same zera, a nie null-e', () => {
    expect(summarizeOrder(ZLECENIE)).toEqual({
      frames: 0,
      delivered: 0,
      stationMs: 0,
      promptUsd: 0,
      promptRuns: 0,
    })
  })

  it('liczy kadry osobno od plików do oddania', () => {
    plik(ZLECENIE, 'generated')
    plik(ZLECENIE, 'generated')
    plik(ZLECENIE, 'export')
    plik(ZLECENIE, 'poster')
    plik(ZLECENIE, 'uploaded')

    const wynik = summarizeOrder(ZLECENIE)

    expect(wynik.frames).toBe(2)
    // Wgrany klip nie jest plikiem do oddania.
    expect(wynik.delivered).toBe(2)
  })

  it('sumuje czas tylko zadań liczących i tylko zakończonych', () => {
    zadanie(ZLECENIE, 'image_generate', 1000, 31_000)
    zadanie(ZLECENIE, 'video_render', 40_000, 42_000)
    // Eksport nie zajmuje stacji w tym sensie — nie wchodzi do sumy.
    zadanie(ZLECENIE, 'image_export', 50_000, 50_500)
    // Zadanie jeszcze biegnące nie ma końca i nie może zaniżyć sumy.
    zadanie(ZLECENIE, 'image_generate', 60_000, null)

    expect(summarizeOrder(ZLECENIE).stationMs).toBe(32_000)
  })

  it('sumuje zużycie warstwy promptowej', () => {
    for (const koszt of [0.012, 0.008]) {
      db.insert(promptRuns)
        .values({
          id: randomUUID(),
          orderId: ZLECENIE,
          model: 'claude-opus-5',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: koszt,
          briefJson: '{}',
          promptEn: 'x',
          createdAt: 1,
        })
        .run()
    }

    const wynik = summarizeOrder(ZLECENIE)

    expect(wynik.promptRuns).toBe(2)
    expect(wynik.promptUsd).toBeCloseTo(0.02, 6)
  })

  it('nie miesza zleceń', () => {
    plik(INNE, 'generated')
    zadanie(INNE, 'image_generate', 0, 5000)

    expect(summarizeOrder(ZLECENIE).frames).toBe(0)
    expect(summarizeOrder(ZLECENIE).stationMs).toBe(0)
    expect(summarizeOrder(INNE).frames).toBe(1)
  })
})
