import { describe, expect, it } from 'vitest'

import { ryzykownaPoza } from './scene-rules'

/**
 * Ostrzeżenie opiera się na pomiarze, nie na przeczuciu: postać w powietrzu
 * dała 3 błędy anatomii na 3 próby, ta sama postać stojąca 0 na 2.
 */
describe('rozpoznawanie ryzykownej pozy', () => {
  it('wyłapuje postać w locie', () => {
    for (const opis of [
      'Koszykarz wrzucający piłkę do kosza',
      'Dziewczyna w skoku nad kałużą',
      'Tancerka w tańcu na scenie',
      'Biegnący mężczyzna na plaży',
    ]) {
      expect(ryzykownaPoza(opis)).toBe(true)
    }
  })

  it('nie czepia się scen spokojnych', () => {
    for (const opis of [
      'Prawnik przy biurku w kancelarii',
      'Wnętrze gabinetu stomatologicznego',
      'Ekipa budowlana przed blokiem',
      'Portret kobiety w oknie',
    ]) {
      expect(ryzykownaPoza(opis)).toBe(false)
    }
  })

  it('nie zależy od wielkości liter', () => {
    expect(ryzykownaPoza('SKOK NA DESKOROLCE')).toBe(true)
  })
})
