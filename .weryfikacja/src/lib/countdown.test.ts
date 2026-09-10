import { describe, expect, it } from 'vitest'

import {
  COUNTDOWN_VISIBLE_SECONDS,
  formatCountdown,
  IDLE_WARNING_SECONDS,
} from './countdown'

/**
 * Formatowanie czasu to kod, w którym błąd o jedną sekundę siedzi latami
 * niezauważony, więc granice sprawdzamy wprost.
 */

describe('odliczanie do wylogowania', () => {
  it.each([
    [30, '30 s'],
    [7, '7 s'],
    [1, '1 s'],
    [0, '0 s'],
  ])('poniżej minuty pokazuje same sekundy: %i → %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected)
  })

  it.each([
    [60, '1:00'],
    [61, '1:01'],
    [90, '1:30'],
    [599, '9:59'],
    [1800, '30:00'],
  ])('od minuty wzwyż pokazuje minuty i sekundy: %i → %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected)
  })

  it('dopełnia sekundy zerem, żeby licznik nie skakał', () => {
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(65)).not.toBe('1:5')
  })

  it('nie schodzi poniżej zera', () => {
    expect(formatCountdown(-5)).toBe('0 s')
    expect(formatCountdown(-9999)).toBe('0 s')
  })

  it('ucina część ułamkową w dół', () => {
    // Licznik dostaje wartości z dzielenia milisekund, więc trafiają się ułamki.
    expect(formatCountdown(30.9)).toBe('30 s')
    expect(formatCountdown(59.99)).toBe('59 s')
  })

  it('licznik jest ukryty przez większość czasu, widoczny na końcówkę', () => {
    // Odliczanie na oczach przez pół godziny rozprasza; ostatnia minuta
    // to ostrzeżenie, a nie zegar do patrzenia.
    expect(COUNTDOWN_VISIBLE_SECONDS).toBeLessThanOrEqual(120)
    expect(COUNTDOWN_VISIBLE_SECONDS).toBeGreaterThanOrEqual(IDLE_WARNING_SECONDS)
  })

  it('próg ostrzeżenia jest krótszy niż minuta', () => {
    // Czerwony licznik przez pół godziny przestałby cokolwiek znaczyć.
    expect(IDLE_WARNING_SECONDS).toBeGreaterThan(0)
    expect(IDLE_WARNING_SECONDS).toBeLessThan(60)
  })
})
