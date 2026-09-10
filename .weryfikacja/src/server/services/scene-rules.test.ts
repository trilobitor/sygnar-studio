import { describe, expect, it } from 'vitest'

import type { Order } from '@/server/db/schema'
import { applySceneRules, COMPOSITION, paletteFor } from './scene-rules'

/**
 * Decyzja D14: reguły z briefu realizacyjnego składa kod, zawsze tak samo,
 * niezależnie od tego, czy opis przygotował model językowy, czy składacz.
 * Wcześniej ścieżka przez model ich nie stosowała.
 */

function order(industry: Order['industry']): Order {
  return { id: 'x', name: 'Zlecenie', industry, status: 'active', createdAt: 0, updatedAt: 0 }
}

const OPIS_MODELU = 'An empty law office with an oak desk and warm afternoon light.'

describe('reguły sceny doklejane do wyniku modelu', () => {
  it('dokłada martwe strefy kadru', () => {
    expect(applySceneRules(OPIS_MODELU, order('legal'), {})).toContain('middle horizontal band')
  })

  it('nie dubluje reguły, którą model już zastosował', () => {
    const zRegula = `${OPIS_MODELU} ${COMPOSITION}.`
    const wynik = applySceneRules(zRegula, order('legal'), {})
    expect((wynik.match(/middle horizontal band/g) ?? []).length).toBe(1)
  })

  it('dokłada zakaz liter, gdy grafik nie zamówił napisu', () => {
    expect(applySceneRules(OPIS_MODELU, order('legal'), {})).toContain('No lettering')
  })

  it('NIE dokłada zakazu liter, gdy napis jest zamówiony', () => {
    const wynik = applySceneRules(OPIS_MODELU, order('legal'), { textOnImage: 'OTWARTE' })
    expect(wynik).not.toContain('No lettering')
  })

  it('dokłada realia europejskie', () => {
    expect(applySceneRules(OPIS_MODELU, order('build'), {})).toContain('Polish interior')
  })

  it('mieści się w limicie schematu wyniku', () => {
    const dlugi = 'A very detailed scene. '.repeat(80)
    expect(applySceneRules(dlugi, order('legal'), {}).length).toBeLessThanOrEqual(1500)
  })
})

describe('paleta per branża', () => {
  it('daje kancelariom low-key', () => {
    expect(paletteFor(order('legal'), undefined)).toContain('warm browns')
  })

  it('daje klinikom high-key — jedyna branża na jasnym tle', () => {
    expect(paletteFor(order('medical'), undefined)).toContain('high-key')
  })

  it('ustępuje kolorom podanym przez grafika', () => {
    expect(paletteFor(order('legal'), 'butelkowa zieleń')).toContain('butelkowa zieleń')
  })

  it('ma wartość domyślną dla zlecenia bez branży', () => {
    expect(paletteFor(null, undefined).length).toBeGreaterThan(10)
  })
})
