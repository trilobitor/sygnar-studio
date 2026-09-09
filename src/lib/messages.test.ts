import { describe, expect, it } from 'vitest'

import { messageForCode } from './messages'
import { API_ERROR_CODES, JOB_ERROR_CODES } from '@/server/adapters/types'

/**
 * Spójność kodów z komunikatami (#79).
 *
 * Lista kodów jest w SPEC §7a zamknięta, a każdy ma mieć własne zdanie po
 * polsku. Bez tego testu dodanie kodu bez wpisu w słowniku przechodziło
 * niezauważone — grafik dostawał wtedy zdanie zapasowe, identyczne dla
 * zupełnie różnych awarii.
 */
describe('każdy kod błędu ma własny komunikat', () => {
  const wszystkie = [...new Set([...JOB_ERROR_CODES, ...API_ERROR_CODES])]

  it.each(wszystkie)('%s', (kod) => {
    const zdanie = messageForCode(kod)

    expect(zdanie.length, kod).toBeGreaterThan(10)
    // Zdanie zapasowe znaczy brak wpisu w słowniku.
    expect(zdanie, kod).not.toMatch(/^Wystąpił błąd/)
  })

  it('komunikaty nie powtarzają się między kodami', () => {
    // Dwa kody z tym samym zdaniem znaczą, że grafik nie odróżni przyczyn.
    const zdania = wszystkie.map((kod) => messageForCode(kod))
    const unikalne = new Set(zdania)

    expect(unikalne.size).toBe(zdania.length)
  })

  it('żaden komunikat nie zawiera żargonu narzędzi', () => {
    // SPEC §7a: bez słów „ComfyUI", „mflux", „darktable", „sharp", „FFmpeg".
    for (const kod of wszystkie) {
      const zdanie = messageForCode(kod).toLowerCase()
      for (const zargon of ['comfyui', 'mflux', 'darktable', 'sharp', 'ffmpeg', 'sqlite']) {
        expect(zdanie, `${kod} zawiera „${zargon}"`).not.toContain(zargon)
      }
    }
  })
})
