import { describe, expect, it } from 'vitest'

import { cropSchema } from '@/lib/schemas'

/**
 * Prostokąt przycięcia.
 *
 * Serwis sam wymaga bazy i plików na dysku, więc tutaj pilnujemy granicy:
 * co w ogóle wolno przysłać. Reszta — czy prostokąt mieści się w obrazie —
 * jest sprawdzana w serwisie, bo dopiero tam znane są wymiary pliku.
 */
describe('prostokąt przycięcia', () => {
  it('przyjmuje sensowne zaznaczenie', () => {
    expect(cropSchema.safeParse({ left: 10, top: 20, width: 800, height: 600 }).success).toBe(true)
  })

  it('odrzuca ujemne położenie', () => {
    expect(cropSchema.safeParse({ left: -1, top: 0, width: 800, height: 600 }).success).toBe(false)
  })

  it('odrzuca wycinek mniejszy niż sto pikseli', () => {
    // Najmniejszy slot w tabeli ma 624 px wysokości; skalowanie w górę
    // z mniejszego wycinka daje papkę zamiast kadru.
    expect(cropSchema.safeParse({ left: 0, top: 0, width: 99, height: 600 }).success).toBe(false)
    expect(cropSchema.safeParse({ left: 0, top: 0, width: 600, height: 99 }).success).toBe(false)
    expect(cropSchema.safeParse({ left: 0, top: 0, width: 100, height: 100 }).success).toBe(true)
  })

  it('odrzuca wartości ułamkowe', () => {
    // Piksel jest niepodzielny — sharp i tak by je obciął, ale lepiej
    // powiedzieć to na granicy niż milczkiem zaokrąglić.
    expect(cropSchema.safeParse({ left: 0.5, top: 0, width: 800, height: 600 }).success).toBe(false)
  })
})
