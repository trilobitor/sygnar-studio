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

  /*
   * Ten test pilnował wcześniej limitu 1500 i dlatego **gwarantował defekt**
   * SYG-105: warunek spełniało obcięcie reguł z końca wyniku. Limit 1500
   * pochodzi z `promptResultSchema.prompt_en` i dotyczy tego, co wolno zwrócić
   * modelowi — sprawdzane w `prompt.ts:92`, czyli zanim reguły w ogóle zostaną
   * doklejone (`prompt.ts:119`). Wynik z regułami trafia do `promptEn`,
   * gdzie limit wynosi 2000.
   */
  it('mieści się w limicie pola, do którego trafia wynik', () => {
    const dlugi = 'A very detailed scene. '.repeat(80)
    expect(applySceneRules(dlugi, order('legal'), {}).length).toBeLessThanOrEqual(2000)
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

/**
 * SYG-105 — reguły znikały po cichu przy dłuższym opisie.
 *
 * `applySceneRules` doklejało cztery obowiązkowe reguły briefu na końcu,
 * a potem obcinało całość do 1500 znaków **od końca** — czyli kasowało
 * dokładnie je, zostawiając swobodny opis modelu. Zmierzone przed poprawką:
 * przy opisie 900 znaków ginął zakaz liter i realia polskie, przy 1500
 * nie zostawało nic, a opis bez kropki na końcu dawał prompt pusty.
 *
 * Te testy nie istniały, bo żaden przypadek w tym pliku nie przekraczał
 * progu obcinania. Defekt przeszedł przez komplet zielonych testów.
 */
describe('długi opis nie wypycha reguł z promptu (SYG-105)', () => {
  const REGULY: Array<[string, string]> = [
    ['kompozycja §4.5', 'middle horizontal band'],
    ['zakaz liter §4.6', 'No lettering'],
    ['realia polskie §4.7', 'Polish interior'],
    ['paleta §4.2', 'Rendered with'],
  ]

  /** Opis o zadanej długości, zakończony kropką. */
  function opisDlugi(znakow: number): string {
    return `${'A calm law office with an oak desk and soft daylight. '.repeat(60).slice(0, znakow - 1)}.`
  }

  it.each([400, 900, 1000, 1200, 1500])(
    'przy opisie %i znaków zostają wszystkie cztery reguły',
    (znakow) => {
      const wynik = applySceneRules(opisDlugi(znakow), order('legal'), {})
      for (const [nazwa, marker] of REGULY) {
        expect(wynik, `zgubiona reguła: ${nazwa}`).toContain(marker)
      }
    },
  )

  it('mieści się w limicie pola promptEn, czyli 2000 znaków', () => {
    for (const znakow of [900, 1500, 1900]) {
      expect(applySceneRules(opisDlugi(znakow), order('legal'), {}).length).toBeLessThanOrEqual(2000)
    }
  })

  it('opis bez kropki na końcu nie daje pustego promptu', () => {
    // Obcinanie na granicy zdania nie miało czego znaleźć i zwracało "".
    const bezKropki = 'A calm law office with an oak desk and soft daylight '.repeat(40).slice(0, 1500)
    const wynik = applySceneRules(bezKropki, order('legal'), {})

    // Pusty prompt nie przeszedłby walidacji `promptEn` (min 10 znaków),
    // więc grafik dostawał wyszarzony przycisk bez wyjaśnienia.
    expect(wynik.length).toBeGreaterThan(10)
    expect(wynik).toContain('middle horizontal band')
  })

  it('przycina opis, a nie reguły — zachowuje początek opisu', () => {
    const wynik = applySceneRules(opisDlugi(1900), order('legal'), {})
    expect(wynik.startsWith('A calm law office')).toBe(true)
  })
})
