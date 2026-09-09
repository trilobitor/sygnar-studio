import { mkdtemp, writeFile } from 'node:fs/promises'
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

  it('wybiera najwyższą jakość mieszczącą się w limicie', async () => {
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

    // Luźniejszy limit musi dać jakość nie niższą niż ciaśniejszy.
    expect(luzny.quality ?? 0).toBeGreaterThanOrEqual(ciasny.quality ?? 0)
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
    expect(await readDimensions(sourcePath)).toEqual({ width: 1200, height: 900 })
  })

  it('zwraca null dla pliku, który nie jest obrazem', async () => {
    expect(await readDimensions('/nieistniejacy/plik.png')).toBeNull()
  })
})
