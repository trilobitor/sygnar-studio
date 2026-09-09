import { describe, expect, it } from 'vitest'

import { nazwaWyjscia } from './mflux'

/**
 * Ten test istnieje, bo błąd przeszedł do produkcji i zablokował grafikowi
 * generowanie.
 *
 * mflux dokleja `_seed_{seed}` do rdzenia nazwy **wyłącznie gdy numerów jest
 * więcej niż jeden** (`cli/parser/parsers.py`). Wcześniejsza wersja podawała
 * `kadr_seed_{seed}.png` zawsze i sprawdzona była tylko na jednym numerze —
 * tam działa. Przy czterech wariantach, czyli w normalnej pracy, pliki
 * wychodziły jako `kadr_seed_123_seed_123.png`, adapter ich nie znajdował
 * i przerywał zadanie kodem COMFY_WORKFLOW_INVALID.
 */
describe('wzorzec nazwy pliku dla mfluxa', () => {
  it('przy jednym numerze niesie znacznik, bo mflux nic nie dokleja', () => {
    expect(nazwaWyjscia(1)).toBe('kadr_seed_{seed}.png')
  })

  it('przy wielu numerach jest goły, bo przyrostek dokleja mflux', () => {
    expect(nazwaWyjscia(4)).toBe('kadr.png')
  })

  it('nigdy nie prowadzi do podwojenia numeru', () => {
    // Odtworzenie usterki: wzorzec ze znacznikiem plus przyrostek mfluxa
    // dawał `kadr_seed_123_seed_123.png`.
    for (const ile of [2, 3, 4, 8]) {
      const wzor = nazwaWyjscia(ile)
      const poDoklejeniu = wzor.replace(/\.png$/, '_seed_123.png')

      expect(poDoklejeniu).toBe('kadr_seed_123.png')
      expect(poDoklejeniu).not.toContain('seed_123_seed')
    }
  })
})
