import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * `src/test-setup.ts` celowo wskazuje nieistniejący FFmpeg, żeby reszta testów
 * nie odpalała procesów. Tutaj jest odwrotnie: `probeVideo` ma sens wyłącznie
 * puszczone na prawdziwy plik, bo jego zadaniem jest podać panelowi montażu
 * długość klipu. Dlatego podmieniamy ścieżkę **przed** wczytaniem modułu —
 * `env` czyta `process.env` raz, przy imporcie.
 */
const ffmpegBin = (() => {
  try {
    return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
})()

if (ffmpegBin === null) {
  throw new Error('test wymaga FFmpeg na PATH — bez niego nie sprawdza niczego')
}

process.env.FFMPEG_PATH = ffmpegBin

const { buildFilterChain, probeVideo } = await import('./ffmpeg')

const katalog = mkdtempSync(join(tmpdir(), 'sygnar-ffmpeg-'))

afterAll(() => {
  rmSync(katalog, { recursive: true, force: true })
})

describe('probeVideo', () => {
  it('czyta długość i wymiary prawdziwego pliku', async () => {
    const plik = join(katalog, 'proba.mp4')

    execFileSync(ffmpegBin, [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'testsrc=size=640x360:rate=25:duration=3',
      '-pix_fmt', 'yuv420p',
      '-y', plik,
    ])

    const wynik = await probeVideo(plik)

    expect(wynik.width).toBe(640)
    expect(wynik.height).toBe(360)
    // Kontener zaokrągla, więc dopuszczamy 50 ms luzu wokół trzech sekund.
    expect(wynik.durationMs).toBeGreaterThanOrEqual(2950)
    expect(wynik.durationMs).toBeLessThanOrEqual(3050)
  })

  it('na braku pliku zwraca same null zamiast wybuchać', async () => {
    const wynik = await probeVideo(join(katalog, 'nie-ma-mnie.mp4'))

    expect(wynik).toEqual({ durationMs: null, width: null, height: null })
  })
})

describe('buildFilterChain', () => {
  it('kadruje przed odwróceniem, żeby pętla działała na gotowym kadrze', () => {
    const chain = buildFilterChain([
      { kind: 'crop', aspect: 'vertical' },
      { kind: 'loop', pingPong: true },
    ])

    expect(chain).not.toBeNull()
    expect(chain).toContain('split[a][b]')
    expect(chain?.indexOf('crop')).toBeLessThan(chain?.indexOf('split') ?? -1)
  })

  it('bez operacji nie narzuca łańcucha filtrów', () => {
    expect(buildFilterChain([])).toBeNull()
  })

  it('samo przycięcie nie tworzy filtra — robi je -ss/-t', () => {
    expect(buildFilterChain([{ kind: 'trim', startMs: 0, endMs: 1000 }])).toBeNull()
  })
})

describe('nagłówek Range', () => {
  it('sufit pętli jest ustawiony poniżej tego, co znosi pamięć', async () => {
    // Filtr `reverse` trzyma cały odwracany materiał w RAM — zmierzone
    // 1,99 GB dla 20 s w 1080p, czyli około 100 MB na sekundę. Przy limicie
    // wgrania 100 MB da się przysłać klip na kilka minut.
    const { MAX_PETLA_MS } = await import('@/server/services/video')

    expect(MAX_PETLA_MS).toBeLessThanOrEqual(20_000)
    // SPEC §679 mówi o pętli 10-sekundowej, więc sufit nie może być niższy.
    expect(MAX_PETLA_MS).toBeGreaterThanOrEqual(10_000)
  })
})
