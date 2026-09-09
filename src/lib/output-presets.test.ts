import { describe, expect, it } from 'vitest'

import {
  MAX_GENERATION_PIXELS,
  OUTPUT_PRESETS,
  PURPOSE_KEYS,
  upscaleFactor,
  type PurposeKey,
} from './output-presets'

/**
 * Walidacja limitu powierzchni obrazu jest testem obowiązkowym (SPEC §14).
 * Przekroczenie limitu nie jest kwestią estetyki — przy 32 GB w maszynie
 * kończy się wyczerpaniem pamięci w trakcie zadania.
 */

const entries = Object.entries(OUTPUT_PRESETS) as [PurposeKey, (typeof OUTPUT_PRESETS)[PurposeKey]][]

describe('presety wyjściowe', () => {
  it.each(entries)('preset %s mieści się w limicie powierzchni', (_key, preset) => {
    const pixels = preset.generate.width * preset.generate.height
    expect(pixels).toBeLessThanOrEqual(MAX_GENERATION_PIXELS)
  })

  it.each(entries)('preset %s ma wymiary generowania podzielne przez 16', (_key, preset) => {
    expect(preset.generate.width % 16).toBe(0)
    expect(preset.generate.height % 16).toBe(0)
  })

  it.each(entries)('preset %s trzyma się limitów schematu generowania', (_key, preset) => {
    // Zakres z `generateJobSchema` w SPEC §7.
    expect(preset.generate.width).toBeGreaterThanOrEqual(256)
    expect(preset.generate.height).toBeGreaterThanOrEqual(256)
    expect(preset.generate.width).toBeLessThanOrEqual(2048)
    expect(preset.generate.height).toBeLessThanOrEqual(2048)
  })

  it.each(entries)('preset %s ma dodatni limit wagi i choć jeden format', (_key, preset) => {
    expect(preset.maxWeightKb).toBeGreaterThan(0)
    expect(preset.formats.length).toBeGreaterThan(0)
  })

  it('nie dubluje członów nazwy pliku', () => {
    const slugs = entries.map(([, preset]) => preset.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('wylicza współczynnik skalowania zgodnie z decyzją D6', () => {
    // Zmierzone w E0: skalowanie powyżej ~1,7× liniowo daje miękki plik.
    for (const key of PURPOSE_KEYS) {
      expect(upscaleFactor(key)).toBeLessThanOrEqual(1.7)
    }
  })

  it('zachowuje proporcje między generowaniem a dostarczaniem', () => {
    for (const [key, preset] of entries) {
      const generated = preset.generate.width / preset.generate.height
      const delivered = preset.deliver.width / preset.deliver.height
      // Tolerancja bierze się z zaokrąglenia wymiarów do wielokrotności 16.
      expect(Math.abs(generated - delivered), `preset ${key}`).toBeLessThan(0.02)
    }
  })
})
