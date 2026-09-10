import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  MIN_SRODEK,
  SZEROKOSC_LEWEJ,
  SZEROKOSC_PASKA,
  SZEROKOSC_PRAWEJ,
  szerokoscSrodka,
  zwinieteKolumny,
} from './uklad'

const NIC_ZAPAMIETANE = { lewa: false, prawa: false }

describe('zwinieteKolumny', () => {
  it('zostawia obie rozwinięte, dopóki na podgląd starcza miejsca', () => {
    // 1366 px: 1366 − 256 − 288 = 822, powyżej progu 640
    expect(zwinieteKolumny(1366, NIC_ZAPAMIETANE)).toEqual({ lewa: false, prawa: false })
    expect(zwinieteKolumny(1280, NIC_ZAPAMIETANE)).toEqual({ lewa: false, prawa: false })
  })

  it('zwija najpierw prawą, bo przy ciasnym ekranie grafik przegląda kadry', () => {
    // 1100 − 256 − 288 = 556, poniżej progu; ale 1100 − 256 − 40 = 804 wystarcza
    expect(zwinieteKolumny(1100, NIC_ZAPAMIETANE)).toEqual({ lewa: false, prawa: true })
  })

  it('zwija obie, gdy sama lista zleceń już nie mieści się z podglądem', () => {
    // powiększenie 150% na 1366 px daje 911 px szerokości logicznej
    expect(zwinieteKolumny(911, NIC_ZAPAMIETANE)).toEqual({ lewa: true, prawa: true })
  })

  it('oddaje podglądowi to, co odebrał próg', () => {
    const stan = zwinieteKolumny(911, NIC_ZAPAMIETANE)
    // przed poprawką zostawało 911 − 256 − 288 = 367 px
    expect(szerokoscSrodka(911, { lewa: false, prawa: false })).toBe(367)
    expect(szerokoscSrodka(911, stan)).toBe(831)
  })

  it('nie rozwija kolumny, którą grafik zwinął sam', () => {
    expect(zwinieteKolumny(1920, { lewa: true, prawa: false })).toEqual({
      lewa: true,
      prawa: false,
    })
  })

  it('trzyma się progu dokładnie na granicy', () => {
    const graniczna = MIN_SRODEK + SZEROKOSC_LEWEJ + SZEROKOSC_PRAWEJ
    expect(zwinieteKolumny(graniczna, NIC_ZAPAMIETANE).prawa).toBe(false)
    expect(zwinieteKolumny(graniczna - 1, NIC_ZAPAMIETANE).prawa).toBe(true)
  })
})

describe('stałe zgadzają się z klasami Tailwinda', () => {
  /*
   * Tailwind skanuje literały w kodzie, więc klas nie da się złożyć ze stałej.
   * Ten test jest jedyną rzeczą, która zauważy, że ktoś zmienił `w-64` na
   * `w-56`, a stałą zostawił — a wtedy próg liczyłby się od złej liczby.
   */
  const zrodlo = readFileSync(new URL('../components/studio/StudioScreen.tsx', import.meta.url), 'utf8')
  const klasy: Array<[string, number]> = [
    ['w-64', SZEROKOSC_LEWEJ],
    ['w-72', SZEROKOSC_PRAWEJ],
    ['w-10', SZEROKOSC_PASKA],
  ]

  it.each(klasy)('%s odpowiada %i px i nadal jest w komponencie', (klasa) => {
    expect(zrodlo).toContain(klasa)
  })

  it('skala Tailwinda to 4 px na jednostkę', () => {
    expect(SZEROKOSC_LEWEJ).toBe(64 * 4)
    expect(SZEROKOSC_PRAWEJ).toBe(72 * 4)
    expect(SZEROKOSC_PASKA).toBe(10 * 4)
  })
})
