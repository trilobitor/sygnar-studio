import { describe, expect, it } from 'vitest'

import { bezpieczneWejscie } from './LoginForm'

/**
 * Otwarte przekierowanie po zalogowaniu (#34). Warunek `startsWith('/')`
 * przepuszczał `//zly-adres.pl`, bo to też zaczyna się od ukośnika —
 * a przeglądarka czyta taki zapis jako adres bezwzględny.
 */
describe('adres powrotu po zalogowaniu', () => {
  it('przepuszcza ścieżkę we własnej aplikacji', () => {
    expect(bezpieczneWejscie('/zlecenia/abc')).toBe('/zlecenia/abc')
  })

  it('odrzuca adres bezwzględny', () => {
    expect(bezpieczneWejscie('https://zly-adres.pl')).toBe('/')
  })

  it('odrzuca adres bezprotokołowy — to była właściwa dziura', () => {
    expect(bezpieczneWejscie('//zly-adres.pl')).toBe('/')
    expect(bezpieczneWejscie('//zly-adres.pl/cokolwiek')).toBe('/')
  })

  it('odrzuca odwrotny ukośnik, bo bywa normalizowany', () => {
    expect(bezpieczneWejscie('/\\zly-adres.pl')).toBe('/')
  })

  it('brak parametru prowadzi na stronę główną', () => {
    expect(bezpieczneWejscie(null)).toBe('/')
    expect(bezpieczneWejscie('')).toBe('/')
  })
})
