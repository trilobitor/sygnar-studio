import { describe, expect, it } from 'vitest'

import { odmiana } from './messages'

const PODEJSCIE: [string, string, string] = ['podejście', 'podejścia', 'podejść']
const ZADANIE: [string, string, string] = ['zadanie', 'zadania', 'zadań']

describe('odmiana liczebników', () => {
  it('liczba pojedyncza', () => {
    expect(odmiana(1, PODEJSCIE)).toBe('podejście')
  })

  it('dwa do czterech', () => {
    for (const n of [2, 3, 4]) expect(odmiana(n, PODEJSCIE)).toBe('podejścia')
  })

  it('pięć i więcej', () => {
    // Panel pisał „Policz 4 podejść" — dokładnie ta pomyłka.
    for (const n of [0, 5, 6, 8, 11, 25]) expect(odmiana(n, PODEJSCIE)).toBe('podejść')
  })

  it('nastki idą dopełniaczem, mimo końcówki 2-4', () => {
    // „12 zadania" brzmi źle i jest błędne — to wyjątek od reguły 2–4.
    for (const n of [12, 13, 14, 112, 113]) expect(odmiana(n, ZADANIE)).toBe('zadań')
  })

  it('dwudziestki dwójki wracają do formy mnogiej', () => {
    for (const n of [22, 23, 24, 102, 1003]) expect(odmiana(n, ZADANIE)).toBe('zadania')
  })
})
