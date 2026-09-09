import { describe, expect, it } from 'vitest'

import { MAX_GENERATION_PIXELS, OUTPUT_PRESETS } from './output-presets'
import { briefSchema, generateJobSchema } from './schemas'

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
