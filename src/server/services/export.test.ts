import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharpLib from 'sharp'
import { beforeEach, describe, expect, it } from 'vitest'

import { OUTPUT_PRESETS } from '@/lib/output-presets'
import { buildOutputName } from './paths'

/**
 * Testy nazewnictwa i numerowania eksportu (#59). Serwis nie miał żadnych,
 * a właśnie w numerowaniu siedziały dwie usterki: montaż zawsze pisał do
 * „-01", a dwa równoległe eksporty tego samego slotu liczyły ten sam numer.
 */
describe('nazwy plików do oddania', () => {
  it('trzyma konwencję z briefu: branża-slot-numer.rozszerzenie', () => {
    expect(buildOutputName({ industry: 'legal', slug: 'case', index: 3, extension: 'webp' })).toBe(
      'legal-case-03.webp',
    )
  })

  it('numer jest zawsze dwucyfrowy', () => {
    expect(buildOutputName({ industry: 'build', slug: 'og', index: 1, extension: 'jpeg' })).toBe(
      'build-og-01.jpeg',
    )
    expect(buildOutputName({ industry: 'build', slug: 'og', index: 12, extension: 'jpeg' })).toBe(
      'build-og-12.jpeg',
    )
  })

  it('bez branży wchodzi „sygnar"', () => {
    expect(buildOutputName({ industry: null, slug: 'case', index: 1, extension: 'webp' })).toBe(
      'sygnar-case-01.webp',
    )
  })
})

describe('rezerwowanie nazwy przy równoległych eksportach', () => {
  let katalog = ''

  beforeEach(async () => {
    katalog = await mkdtemp(join(tmpdir(), 'sygnar-eksport-'))
  })

  it('flaga `wx` nie pozwala dwóm zapisom trafić w tę samą nazwę', async () => {
    // Sedno usterki #31: licznik z bazy dawał obu zadaniom ten sam numer,
    // bo żadne jeszcze niczego nie zapisało. Atomowość `wx` to rozstrzyga.
    const { open } = await import('node:fs/promises')
    const sciezka = join(katalog, 'legal-case-01.webp')

    const pierwszy = await open(sciezka, 'wx')
    await pierwszy.close()

    await expect(open(sciezka, 'wx')).rejects.toThrow(/EEXIST/)
  })

  it('sekwencja nazw nie zostawia dziur ani duplikatów', async () => {
    const { open } = await import('node:fs/promises')

    for (let i = 1; i <= 3; i += 1) {
      const uchwyt = await open(
        join(katalog, buildOutputName({ industry: 'legal', slug: 'case', index: i, extension: 'webp' })),
        'wx',
      )
      await uchwyt.close()
    }

    const pliki = (await readdir(katalog)).sort()
    expect(pliki).toEqual(['legal-case-01.webp', 'legal-case-02.webp', 'legal-case-03.webp'])
  })
})

describe('presety wyjściowe', () => {
  it('każdy slot ma slug, wymiary i limit wagi', () => {
    for (const [klucz, preset] of Object.entries(OUTPUT_PRESETS)) {
      expect(preset.slug, klucz).toBeTruthy()
      expect(preset.deliver.width, klucz).toBeGreaterThan(0)
      expect(preset.maxWeightKb, klucz).toBeGreaterThan(0)
      expect(preset.formats.length, klucz).toBeGreaterThan(0)
    }
  })

  it('slot OG oddaje JPEG — decyzja D16', async () => {
    // Odstępstwo od briefu §4.8 zapisane w dzienniku: PNG nie schodził
    // do 300 KB na fotografii.
    expect(OUTPUT_PRESETS.og.formats).toContain('jpeg')
  })

  it('PNG w presetach przechodzi przez wyszukiwanie jakości', async () => {
    // #11: ścieżka PNG nie była testowana. Kwantyzacja palety JEST stratna,
    // więc PNG musi być dobierany tak samo jak reszta, nie jednym strzałem.
    const zrodlo = join(await mkdtemp(join(tmpdir(), 'sygnar-png-')), 'z.png')
    await sharpLib({
      create: { width: 400, height: 300, channels: 3, background: { r: 90, g: 120, b: 60 } },
    })
      .png()
      .toFile(zrodlo)

    const { exportToWeight } = await import('@/server/adapters/sharp')
    const wynik = await exportToWeight({
      sourcePath: zrodlo,
      format: 'png',
      width: 400,
      height: 300,
      maxBytes: 200 * 1024,
    })

    expect(wynik.buffer.byteLength).toBeLessThanOrEqual(200 * 1024)
    expect(wynik.quality).not.toBeUndefined()
  })
})
