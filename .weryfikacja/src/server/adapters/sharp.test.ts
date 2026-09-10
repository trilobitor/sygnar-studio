import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharpLib from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { JobError } from './types'
import { exportToWeight, MAX_QUALITY_ITERATIONS, readDimensions } from './sharp'

/**
 * Dobieranie jakości do limitu wagi jest testem obowiązkowym (SPEC §14).
 * Nie testujemy, że sharp umie kompresować — testujemy, że nasze
 * wyszukiwanie binarne trafia pod limit i wie, kiedy się poddać.
 */

let sourcePath = ''

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sygnar-sharp-'))
  sourcePath = join(dir, 'zrodlo.png')

  // Fixture ma się zachowywać jak zdjęcie: miękkie przejścia tonalne,
  // trochę struktury i delikatne ziarno. Czysty szum byłby nieściśliwy
  // i nie sprawdzałby wyszukiwania jakości, tylko granicę formatu.
  const width = 1200
  const height = 900
  const pixels = Buffer.alloc(width * height * 3)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const gradient = (x / width) * 160 + (y / height) * 60
      const structure = Math.sin(x / 40) * 18 + Math.cos(y / 55) * 14
      const grain = ((x * 7 + y * 13) % 11) - 5

      const value = Math.max(0, Math.min(255, gradient + structure + grain))
      pixels[offset] = value
      pixels[offset + 1] = Math.max(0, Math.min(255, value * 0.86))
      pixels[offset + 2] = Math.max(0, Math.min(255, value * 0.7))
    }
  }

  await writeFile(
    sourcePath,
    await sharpLib(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer(),
  )
})

describe('eksport do limitu wagi', () => {
  it('schodzi pod zadany limit', async () => {
    const maxBytes = 120 * 1024
    const outcome = await exportToWeight({
      sourcePath,
      format: 'webp',
      width: 1200,
      height: 900,
      maxBytes,
    })

    expect(outcome.bytes).toBeLessThanOrEqual(maxBytes)
    expect(outcome.quality).not.toBeNull()
  })

  it('nie przekracza dozwolonej liczby prób', async () => {
    const outcome = await exportToWeight({
      sourcePath,
      format: 'webp',
      width: 1200,
      height: 900,
      maxBytes: 200 * 1024,
    })

    expect(outcome.iterations).toBeLessThanOrEqual(MAX_QUALITY_ITERATIONS)
  })

  it('luźniejszy limit nie daje niższej jakości niż ciaśniejszy', async () => {
    const luzny = await exportToWeight({
      sourcePath,
      format: 'webp',
      width: 1200,
      height: 900,
      maxBytes: 400 * 1024,
    })
    const ciasny = await exportToWeight({
      sourcePath,
      format: 'webp',
      width: 1200,
      height: 900,
      maxBytes: 60 * 1024,
    })

    expect(luzny.quality ?? 0).toBeGreaterThanOrEqual(ciasny.quality ?? 0)
  })

  it('wybrana jakość jest najwyższa możliwa, a nie byle jaka mieszcząca się', async () => {
    /*
     * Poprzednia wersja tego testu sprawdzała wyłącznie, że luźniejszy limit
     * daje jakość nie niższą niż ciaśniejszy. Implementacja zwracająca
     * **zawsze** najniższą jakość przechodziła go bez mrugnięcia, bo 30 ≥ 30.
     *
     * Prawdziwe kryterium jest inne: o jeden stopień wyżej ma się już nie
     * mieścić. Dopiero to znaczy „najwyższa mieszcząca się".
     */
    const maxBytes = 120 * 1024

    const wynik = await exportToWeight({
      sourcePath,
      format: 'webp',
      width: 1200,
      height: 900,
      maxBytes,
    })

    expect(wynik.buffer.byteLength).toBeLessThanOrEqual(maxBytes)
    expect(wynik.quality).not.toBeUndefined()

    const oStopienWyzej = await sharpLib(sourcePath)
      .resize(1200, 900, { fit: 'cover' })
      .webp({ quality: (wynik.quality ?? 0) + 1 })
      .toBuffer()

    // Gdyby się mieściło, wyszukiwanie zatrzymało się za wcześnie.
    expect(oStopienWyzej.byteLength).toBeGreaterThan(maxBytes)
  })

  it('skaluje do wymiaru docelowego', async () => {
    const outcome = await exportToWeight({
      sourcePath,
      format: 'webp',
      width: 2000,
      height: 1500,
      maxBytes: 500 * 1024,
    })

    const metadata = await sharpLib(outcome.buffer).metadata()
    expect(metadata.width).toBe(2000)
    expect(metadata.height).toBe(1500)
  })

  it('rzuca EXPORT_WEIGHT_UNREACHABLE, gdy limit jest nieosiągalny', async () => {
    // Jeden kilobajt na obraz 1200 × 900 jest nie do zejścia w żadnej jakości.
    await expect(
      exportToWeight({ sourcePath, format: 'webp', width: 1200, height: 900, maxBytes: 1024 }),
    ).rejects.toThrow(JobError)
  })

  it('obsługuje AVIF tą samą drogą co WebP', async () => {
    const outcome = await exportToWeight({
      sourcePath,
      format: 'avif',
      width: 600,
      height: 450,
      maxBytes: 120 * 1024,
    })

    expect(outcome.bytes).toBeLessThanOrEqual(120 * 1024)
  })
})

describe('odczyt wymiarów', () => {
  it('czyta wymiary obrazu', async () => {
    expect(await readDimensions(sourcePath)).toEqual({
      width: 1200,
      height: 900,
      // Obraz testowy jest nieprzezroczysty — a to właśnie ta wartość decyduje
      // o szachownicy pod podglądem.
      hasAlpha: false,
    })
  })

  it('zwraca null dla pliku, który nie jest obrazem', async () => {
    expect(await readDimensions('/nieistniejacy/plik.png')).toBeNull()
  })
})

describe('rozpoznawanie kanału alfa', () => {
  it('obraz z przezroczystością jest rozpoznany', async () => {
    const przezroczysty = join(tmpdir(), `alfa-${String(Date.now())}.png`)

    await sharpLib({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toFile(przezroczysty)

    expect((await readDimensions(przezroczysty))?.hasAlpha).toBe(true)
    await rm(przezroczysty, { force: true })
  })

  it('PNG bez przezroczystości nie udaje, że ją ma', async () => {
    // To jest przypadek generatora: mflux zapisuje PNG **bez** alfy, więc
    // rozpoznawanie po rozszerzeniu stawiałoby szachownicę wokół każdego kadru.
    const nieprzezroczysty = join(tmpdir(), `bez-alfy-${String(Date.now())}.png`)

    await sharpLib({
      create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toFile(nieprzezroczysty)

    expect((await readDimensions(nieprzezroczysty))?.hasAlpha).toBe(false)
    await rm(nieprzezroczysty, { force: true })
  })
})
