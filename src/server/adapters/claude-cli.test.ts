import { describe, expect, it } from 'vitest'

import { kontekstWejsciowy } from './claude-cli'

/**
 * Testy warstwy promptowej (#64, #65). Poza składaczem nie było ani jednego,
 * a właśnie tu siedziała usterka, której nie widać z zewnątrz: zapisywana
 * miara zużycia wynosiła stale 2, niezależnie od tego, ile kontekstu poszło
 * do modelu.
 */
describe('miara zużycia kontekstu', () => {
  it('sumuje wejście z odczytem i zapisem cache’u', () => {
    // Zmierzone na żywym CLI: `--allowed-tools ""` dawało 2 tokeny wejścia,
    // 19 150 odczytu i 9 723 zapisu. Zapis „2" nie mówił o niczym.
    expect(
      kontekstWejsciowy({
        input_tokens: 2,
        cache_read_input_tokens: 19_150,
        cache_creation_input_tokens: 9_723,
      }),
    ).toBe(28_875)
  })

  it('radzi sobie z brakującymi polami', () => {
    expect(kontekstWejsciowy({ input_tokens: 5 })).toBe(5)
    expect(kontekstWejsciowy({})).toBe(0)
  })

  it('brak danych o zużyciu to zero, nie wyjątek', () => {
    expect(kontekstWejsciowy(undefined)).toBe(0)
  })

  it('rozróżnia wywołanie tanie od drogiego', () => {
    // To jest cały powód istnienia tej funkcji: dwie postacie wywołania mają
    // identyczne `input_tokens`, a różnią się kontekstem 4,6-krotnie.
    const drogie = kontekstWejsciowy({
      input_tokens: 2,
      cache_read_input_tokens: 19_150,
      cache_creation_input_tokens: 9_723,
    })
    const tanie = kontekstWejsciowy({ input_tokens: 2, cache_creation_input_tokens: 6_215 })

    expect(drogie).toBeGreaterThan(tanie * 4)
  })
})
