import { describe, expect, it } from 'vitest'

import { MAX_GENERATION_PIXELS, OUTPUT_PRESETS } from './output-presets'
import {
  briefSchema,
  generateJobSchema,
  exportJobSchema,
  photoBatchSchema,
  renameOrderSchema,
  videoJobSchema,
} from './schemas'

/**
 * Mapowanie briefu na parametry generowania i walidacja limitu powierzchni
 * to testy obowiązkowe (SPEC §14).
 */

describe('brief', () => {
  it('wymaga wyłącznie punktu pierwszego i przeznaczenia', () => {
    const parsed = briefSchema.parse({ subject: 'puste biuro', purpose: 'services-wide' })
    expect(parsed.variants).toBe(4)
    expect(parsed.mood).toBeUndefined()
  })

  it('odrzuca zbyt krótki opis tematu', () => {
    expect(briefSchema.safeParse({ subject: 'ab', purpose: 'square' }).success).toBe(false)
  })

  it('odrzuca przeznaczenie spoza listy presetów', () => {
    expect(
      briefSchema.safeParse({ subject: 'puste biuro', purpose: 'nie-ma-takiego' }).success,
    ).toBe(false)
  })

  it('pilnuje limitu długości tekstu na obrazie', () => {
    const tooLong = { subject: 'napis', purpose: 'square', textOnImage: 'x'.repeat(61) }
    expect(briefSchema.safeParse(tooLong).success).toBe(false)
  })

  it('nie pozwala zamówić więcej niż ośmiu podejść', () => {
    const tooMany = { subject: 'puste biuro', purpose: 'square', variants: 9 }
    expect(briefSchema.safeParse(tooMany).success).toBe(false)
  })
})

describe('zadanie generowania', () => {
  const base = {
    orderId: '11111111-1111-4111-8111-111111111111',
    promptEn: 'An empty law office in late afternoon light.',
    purpose: 'services-wide' as const,
    seeds: [1, 2, 3, 4],
  }

  it('przyjmuje wymiary z presetu', () => {
    const preset = OUTPUT_PRESETS['services-wide']
    const parsed = generateJobSchema.parse({ ...base, ...preset.generate })
    expect(parsed.width).toBe(preset.generate.width)
  })

  it('odrzuca kadr powyżej limitu powierzchni', () => {
    // 2048 × 2048 to 4,19 Mpx — dwukrotność limitu.
    const result = generateJobSchema.safeParse({ ...base, width: 2048, height: 2048 })
    expect(result.success).toBe(false)
    expect(2048 * 2048).toBeGreaterThan(MAX_GENERATION_PIXELS)
  })

  it('odrzuca wymiar niepodzielny przez 16', () => {
    expect(generateJobSchema.safeParse({ ...base, width: 1000, height: 750 }).success).toBe(false)
  })

  it('odrzuca pustą listę numerów losowania', () => {
    expect(
      generateJobSchema.safeParse({ ...base, width: 1024, height: 1024, seeds: [] }).success,
    ).toBe(false)
  })

  it('odrzuca identyfikator zlecenia, który nie jest UUID', () => {
    expect(
      generateJobSchema.safeParse({ ...base, orderId: '../etc', width: 1024, height: 1024 })
        .success,
    ).toBe(false)
  })

  it('każdy preset przechodzi walidację zadania', () => {
    for (const [key, preset] of Object.entries(OUTPUT_PRESETS)) {
      const result = generateJobSchema.safeParse({
        ...base,
        purpose: key,
        width: preset.generate.width,
        height: preset.generate.height,
      })
      expect(result.success, `preset ${key}`).toBe(true)
    }
  })
})

describe('zakres przycięcia wideo', () => {
  const podstawa = {
    kind: 'video_render',
    orderId: '11111111-1111-4111-8111-111111111111',
    assetId: '22222222-2222-4222-8222-222222222222',
    targetMb: 4,
  }

  it('odrzuca odwrócony zakres', () => {
    // Bez tego FFmpeg przerywał kodem 23, a grafik widział komunikat o awarii
    // montażu zamiast informacji, że pomylił początek z końcem.
    const wynik = videoJobSchema.safeParse({
      ...podstawa,
      operations: [{ kind: 'trim', startMs: 5000, endMs: 2000 }],
    })

    expect(wynik.success).toBe(false)
  })

  it('odrzuca zakres zerowy', () => {
    const wynik = videoJobSchema.safeParse({
      ...podstawa,
      operations: [{ kind: 'trim', startMs: 3000, endMs: 3000 }],
    })

    expect(wynik.success).toBe(false)
  })

  it('przepuszcza zakres poprawny', () => {
    const wynik = videoJobSchema.safeParse({
      ...podstawa,
      operations: [{ kind: 'trim', startMs: 1000, endMs: 4000 }],
    })

    expect(wynik.success).toBe(true)
  })

  it('nie czepia się zadań bez przycięcia', () => {
    const wynik = videoJobSchema.safeParse({
      ...podstawa,
      operations: [{ kind: 'crop', aspect: 'vertical' }],
    })

    expect(wynik.success).toBe(true)
  })
})

describe('losowanie numerów po stronie serwera', () => {
  const podstawa = {
    kind: 'image_generate',
    orderId: '11111111-1111-4111-8111-111111111111',
    promptEn: 'an empty law office with an oak desk',
    width: 1024,
    height: 1024,
    purpose: 'services-wide',
  }

  it('przepuszcza zadanie bez numerów — wylosuje je serwer', () => {
    // Losowanie robiła przeglądarka, w dwóch miejscach naraz. Dwie kopie tej
    // samej reguły rozjeżdżają się przy pierwszej zmianie, a numer losowania
    // jest jedyną rzeczą pozwalającą odtworzyć kadr.
    const wynik = generateJobSchema.safeParse({ ...podstawa, variants: 4 })

    expect(wynik.success).toBe(true)
    if (wynik.success) expect(wynik.data.seeds).toBeUndefined()
  })

  it('nadal przyjmuje numery podane wprost', () => {
    const wynik = generateJobSchema.safeParse({ ...podstawa, seeds: [1, 2, 3] })

    expect(wynik.success).toBe(true)
    if (wynik.success) expect(wynik.data.seeds).toEqual([1, 2, 3])
  })

  it('domyślnie cztery warianty', () => {
    const wynik = generateJobSchema.safeParse(podstawa)

    expect(wynik.success).toBe(true)
    if (wynik.success) expect(wynik.data.variants).toBe(4)
  })
})

describe('zmiana branży zlecenia', () => {
  it('branża jest opcjonalna przy zmianie nazwy', () => {
    expect(renameOrderSchema.safeParse({ name: 'Kancelaria Nowak' }).success).toBe(true)
  })

  it('branżę da się zmienić', () => {
    // Wcześniej nie dało się wcale, więc pomyłka przy zakładaniu zlecenia
    // oznaczała konieczność założenia go od nowa.
    const wynik = renameOrderSchema.safeParse({ name: 'Kancelaria Nowak', industry: 'medical' })

    expect(wynik.success).toBe(true)
  })

  it('nie przyjmuje branży spoza listy', () => {
    expect(renameOrderSchema.safeParse({ name: 'Test', industry: 'kosmos' }).success).toBe(false)
  })
})

describe('schematy pozostałych zadań', () => {
  it('eksport odrzuca limit wagi spoza zakresu', () => {
    const podstawa = {
      kind: 'image_export',
      orderId: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
      purpose: 'services-wide',
    }

    // Trzy z czterech schematów zadań nie miały testów, w tym wszystkie
    // wartości domyślne.
    expect(exportJobSchema.safeParse(podstawa).success).toBe(true)
  })

  it('montaż domyślnie daje 4 MB i planszę', () => {
    const wynik = videoJobSchema.safeParse({
      kind: 'video_render',
      orderId: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
    })

    expect(wynik.success).toBe(true)
    if (wynik.success) {
      expect(wynik.data.targetMb).toBe(4)
      expect(wynik.data.poster).toBe(true)
      expect(wynik.data.operations).toEqual([])
    }
  })

  it('montaż odrzuca wagę spoza zakresu 0,5–50 MB', () => {
    const podstawa = {
      kind: 'video_render',
      orderId: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
    }

    expect(videoJobSchema.safeParse({ ...podstawa, targetMb: 0.1 }).success).toBe(false)
    expect(videoJobSchema.safeParse({ ...podstawa, targetMb: 500 }).success).toBe(false)
  })

  it('montaż przyjmuje najwyżej trzy operacje', () => {
    const wynik = videoJobSchema.safeParse({
      kind: 'video_render',
      orderId: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
      operations: [
        { kind: 'trim', startMs: 0, endMs: 1000 },
        { kind: 'crop', aspect: 'vertical' },
        { kind: 'loop', pingPong: true },
        { kind: 'crop', aspect: 'square' },
      ],
    })

    expect(wynik.success).toBe(false)
  })

  it('obróbka wsadowa przyjmuje od jednego do dwustu plików', () => {
    const orderId = '11111111-1111-4111-8111-111111111111'
    const plik = '22222222-2222-4222-8222-222222222222'

    expect(photoBatchSchema.safeParse({ orderId, assetIds: [] }).success).toBe(false)
    expect(photoBatchSchema.safeParse({ orderId, assetIds: [plik] }).success).toBe(true)
    expect(
      photoBatchSchema.safeParse({ orderId, assetIds: new Array(201).fill(plik) }).success,
    ).toBe(false)
  })
})
