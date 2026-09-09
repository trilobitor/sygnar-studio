import { describe, expect, it } from 'vitest'

import { briefSchema, type Brief } from '@/lib/schemas'
import type { Order } from '@/server/db/schema'
import { buildPrompt, looksPolish } from './prompt-builder'

/**
 * Składacz deterministyczny jest ostatnią linią obrony warstwy promptowej —
 * gdy zawiodą oba źródła sieciowe, to on musi oddać sensowny opis sceny.
 * Nie ma tu sieci, więc testy sprawdzają dokładnie to, co kod obiecuje.
 */

function brief(overrides: Partial<Brief> = {}): Brief {
  return briefSchema.parse({
    subject: 'an empty law office with an oak desk',
    purpose: 'services-wide',
    ...overrides,
  })
}

function order(industry: Order['industry']): Order {
  return {
    id: 'test',
    name: 'Zlecenie',
    industry,
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('składanie opisu sceny', () => {
  it('zawsze oddaje niepusty opis', () => {
    const result = buildPrompt(brief(), null)
    expect(result.promptEn.length).toBeGreaterThan(50)
  })

  it('mieści się w limicie ze schematu wyniku', () => {
    const long = brief({
      subject: 'a'.repeat(500),
      place: 'b'.repeat(300),
      colors: 'c'.repeat(150),
    })
    expect(buildPrompt(long, null).promptEn.length).toBeLessThanOrEqual(1500)
  })

  it('zaczyna od tematu podanego przez grafika', () => {
    const result = buildPrompt(brief({ subject: 'a quiet reading room' }), null)
    expect(result.promptEn.startsWith('A quiet reading room')).toBe(false)
    expect(result.promptEn).toContain('a quiet reading room')
  })

  it('dokleja miejsce do tematu', () => {
    const result = buildPrompt(brief({ place: 'a modern Warsaw office' }), null)
    expect(result.promptEn).toContain('in a modern Warsaw office')
  })

  it('trzyma temat w środkowym pasie kadru', () => {
    // Martwe strefy z briefu §4.5 — górne 15% i dolne 35% zasłaniają nakładki.
    expect(buildPrompt(brief(), null).promptEn).toContain('middle horizontal band')
  })

  it('pisze pełnymi zdaniami, nie listą słów kluczowych', () => {
    const promptEn = buildPrompt(brief(), null).promptEn
    const words = promptEn.split(/\s+/).length
    const commas = (promptEn.match(/,/g) ?? []).length
    // Lista słów kluczowych ma przecinek co dwa–trzy słowa; proza znacznie rzadziej.
    expect(words / Math.max(commas, 1)).toBeGreaterThan(5)
  })
})

describe('paleta zależna od branży', () => {
  it('daje kancelariom low-key i ciepłe brązy', () => {
    expect(buildPrompt(brief(), order('legal')).promptEn).toContain('warm browns')
  })

  it('daje klinikom high-key — jedyna branża na jasnym tle', () => {
    const promptEn = buildPrompt(brief(), order('medical')).promptEn
    expect(promptEn).toContain('high-key')
    expect(promptEn).not.toContain('low-key')
  })

  it('ustępuje kolorom podanym przez grafika', () => {
    const result = buildPrompt(brief({ colors: 'butelkowa zieleń i mosiądz' }), order('legal'))
    expect(result.promptEn).toContain('butelkowa zieleń i mosiądz')
    expect(result.promptEn).not.toContain('warm browns')
  })
})

describe('założenia wypisywane grafikowi', () => {
  it('wypisuje, co uzupełnił za grafika', () => {
    const result = buildPrompt(brief(), order('legal'))
    expect(result.assumptions.length).toBeGreaterThan(0)
    expect(result.assumptions.length).toBeLessThanOrEqual(3)
  })

  it('milczy o stylu, gdy grafik go podał', () => {
    const result = buildPrompt(brief({ style: 'photo', shot: 'medium', lighting: 'studio' }), null)
    expect(result.assumptions.join(' ')).not.toContain('Przyjąłem fotografię')
  })

  it('ostrzega, gdy pole „czego unikać" zostało po polsku', () => {
    const result = buildPrompt(brief({ avoid: 'nie chcę ludzi w kadrze' }), null)
    expect(result.assumptions.join(' ')).toContain('czego unikać')
  })
})

describe('tekst na obrazie', () => {
  it('wymienia napis dokładnie raz', () => {
    const promptEn = buildPrompt(brief({ textOnImage: 'OTWARTE' }), null).promptEn
    expect((promptEn.match(/OTWARTE/g) ?? []).length).toBe(1)
  })

  it('ostrzega przy długim napisie', () => {
    const result = buildPrompt(brief({ textOnImage: 'KANCELARIA ADWOKACKA NOWAK' }), null)
    expect(result.assumptions.join(' ')).toContain('zniekształcone')
  })

  it('bez napisu dokłada zakaz liter w kadrze', () => {
    expect(buildPrompt(brief(), null).promptEn).toContain('No lettering')
  })
})

describe('wykrywanie polszczyzny', () => {
  it.each([
    'wnętrze kancelarii, późne popołudnie',
    'puste biuro z dębowym biurkiem',
    'zdjecie biura ktore jest puste',
  ])('rozpoznaje polski w %s', (text) => {
    expect(looksPolish(text)).toBe(true)
  })

  it.each([
    'an empty law office with an oak desk',
    'a quiet reading room with tall windows',
  ])('nie myli angielskiego z polskim: %s', (text) => {
    expect(looksPolish(text)).toBe(false)
  })
})
