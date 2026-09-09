import { describe, expect, it } from 'vitest'

import { estimateCostUsd } from './prompt'

/**
 * Koszt wywołania warstwy promptowej.
 *
 * Tokeny z bufora mają własne stawki i wcześniej w ogóle nie wchodziły do
 * rachunku: pierwszy brief był policzony za tanio, każdy następny — za drogo.
 */
describe('koszt wywołania warstwy promptowej', () => {
  it('zwykłe wejście i wyjście liczone po stawkach podstawowych', () => {
    // 1 mln wejścia po 5 USD, 1 mln wyjścia po 25 USD.
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBeCloseTo(30, 6)
  })

  it('zapis do bufora kosztuje więcej niż zwykłe wejście', () => {
    const zwykle = estimateCostUsd(1_000_000, 0)
    const zBuforem = estimateCostUsd(0, 0, 1_000_000)

    expect(zBuforem).toBeGreaterThan(zwykle)
    expect(zBuforem / zwykle).toBeCloseTo(1.25, 6)
  })

  it('odczyt z bufora kosztuje dziesiątą część zwykłego wejścia', () => {
    const zwykle = estimateCostUsd(1_000_000, 0)
    const zBufora = estimateCostUsd(0, 0, 0, 1_000_000)

    expect(zBufora / zwykle).toBeCloseTo(0.1, 6)
  })

  it('drugi brief z rzędu jest tańszy od pierwszego', () => {
    // Prompt systemowy to ~1200 tokenów. Za pierwszym razem trafia do bufora,
    // za drugim jest z niego czytany.
    const pierwszy = estimateCostUsd(300, 400, 1200, 0)
    const drugi = estimateCostUsd(300, 400, 0, 1200)

    expect(drugi).toBeLessThan(pierwszy)
  })

  it('brak tokenów bufora daje ten sam wynik co przed zmianą', () => {
    expect(estimateCostUsd(1000, 500, 0, 0)).toBeCloseTo(estimateCostUsd(1000, 500), 12)
  })
})
