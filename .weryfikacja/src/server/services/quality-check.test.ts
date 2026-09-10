import { describe, expect, it } from 'vitest'

import { OUTPUT_PRESETS } from '@/lib/output-presets'
import type { Asset } from '@/server/db/schema'

import { brakujaceFormaty, PROG_JAKOSCI, sprawdzPlik } from './quality-check'

/**
 * Kontrola przed oddaniem.
 *
 * Testy pilnują, żeby lista zastrzeżeń brała się wyłącznie z liczb i żeby
 * plik bez zarzutu naprawdę przechodził — bez tego drugiego kontrola byłaby
 * alarmem, który dzwoni zawsze.
 */

const PRESET = OUTPUT_PRESETS['services-wide']

function plik(nadpisania: Partial<Asset> = {}): Asset {
  return {
    id: 'a',
    orderId: 'o',
    jobId: null,
    kind: 'export',
    path: 'orders/o/exports/plik.avif',
    mime: 'image/avif',
    bytes: 150_000,
    width: PRESET.deliver.width,
    height: PRESET.deliver.height,
    durationMs: null,
    seed: null,
    metadataJson: JSON.stringify({ purpose: 'services-wide', quality: 82 }),
    starred: 0,
    createdAt: 1,
    ...nadpisania,
  }
}

describe('kontrola przed oddaniem', () => {
  it('plik zgodny z presetem nie ma zastrzeżeń', () => {
    expect(sprawdzPlik(plik())).toEqual([])
  })

  it('jakość poniżej progu jest zgłaszana', () => {
    const uwagi = sprawdzPlik(
      plik({ metadataJson: JSON.stringify({ purpose: 'services-wide', quality: PROG_JAKOSCI - 1 }) }),
    )

    expect(uwagi.map((u) => u.kod)).toContain('jakosc')
    expect(uwagi[0]?.tresc).toContain(String(PROG_JAKOSCI - 1))
  })

  it('jakość dokładnie na progu przechodzi', () => {
    const uwagi = sprawdzPlik(
      plik({ metadataJson: JSON.stringify({ purpose: 'services-wide', quality: PROG_JAKOSCI }) }),
    )

    expect(uwagi).toEqual([])
  })

  it('wymiar niezgodny z presetem jest zgłaszany', () => {
    const uwagi = sprawdzPlik(plik({ width: 1999 }))

    expect(uwagi.map((u) => u.kod)).toEqual(['wymiar'])
    expect(uwagi[0]?.tresc).toContain('1999')
  })

  it('format spoza listy presetu jest zgłaszany', () => {
    const uwagi = sprawdzPlik(plik({ mime: 'image/jpeg' }))

    expect(uwagi.map((u) => u.kod)).toEqual(['format'])
  })

  it('pusty plik przerywa dalsze sprawdzanie', () => {
    // Przy zerowej długości wymiar i jakość nic nie znaczą — jedno zdanie
    // zamiast lawiny zastrzeżeń.
    const uwagi = sprawdzPlik(plik({ bytes: 0, width: 1 }))

    expect(uwagi).toHaveLength(1)
    expect(uwagi[0]?.kod).toBe('pusty')
  })

  it('brak przeznaczenia w metadanych jest zgłaszany', () => {
    expect(sprawdzPlik(plik({ metadataJson: null })).map((u) => u.kod)).toEqual(['brak-presetu'])
  })

  it('brakujący format w zestawie jest widoczny dopiero na całości', () => {
    // Sam AVIF przechodzi jako pojedynczy plik, ale preset wymaga też WebP.
    const same = [plik()]

    expect(sprawdzPlik(same[0]!)).toEqual([])
    expect(brakujaceFormaty(same).map((u) => u.tresc)).toEqual([
      expect.stringContaining('WEBP') as unknown as string,
    ])
  })

  it('komplet formatów nie budzi alarmu', () => {
    const komplet = [plik(), plik({ id: 'b', mime: 'image/webp' })]

    expect(brakujaceFormaty(komplet)).toEqual([])
  })
})
