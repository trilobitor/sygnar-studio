import { writeFile } from 'node:fs/promises'

import sharpLib, { type Sharp } from 'sharp'

import { JobError, type HealthStatus, type JobContext } from './types'

/**
 * Adapter eksportu obrazów (SPEC §6). Działa w procesie, bez subprocessu.
 *
 * Jakość dobierana jest do limitu wagi przez wyszukiwanie binarne,
 * maksymalnie osiem iteracji, a wynik zapisujemy w metadanych pliku.
 */

export type ExportFormat = 'avif' | 'webp' | 'png' | 'jpeg'

/** Górna granica liczby prób. Każda próba to pełna kompresja obrazu. */
export const MAX_QUALITY_ITERATIONS = 8

export interface ExportRequest {
  sourcePath: string
  format: ExportFormat
  /** Wymiar docelowy. Skalowanie w górę robimy Lanczosem (decyzja D6). */
  width: number
  height: number
  maxBytes: number
}

export interface ExportOutcome {
  buffer: Buffer
  bytes: number
  /** Jakość, przy której się udało. `null` dla PNG, który jej nie ma. */
  quality: number | null
  iterations: number
}

export async function checkSharp(): Promise<HealthStatus> {
  try {
    // Wywołanie, które realnie dotyka natywnej części biblioteki.
    await sharpLib({
      create: { width: 16, height: 16, channels: 3, background: '#000000' },
    })
      .webp()
      .toBuffer()

    return { ok: true, version: sharpLib.versions.sharp }
  } catch {
    // sharp jest w zależnościach, więc brak działania oznacza złą instalację.
    return { ok: false, reason: 'misconfigured' }
  }
}

function encode(
  source: Sharp,
  format: ExportFormat,
  quality: number,
): Promise<Buffer> {
  switch (format) {
    case 'avif':
      return source.clone().avif({ quality }).toBuffer()
    case 'webp':
      return source.clone().webp({ quality }).toBuffer()
    case 'jpeg':
      return source.clone().jpeg({ quality, mozjpeg: true }).toBuffer()
    case 'png':
      // PNG z paletą **nie jest bezstratny** — kwantyzacja barw to stratna
      // operacja, a `quality` steruje właśnie nią. Wcześniejszy komentarz
      // twierdził inaczej i dlatego PNG szedł jednym strzałem, bez szukania
      // jakości mieszczącej się w limicie wagi.
      return source
        .clone()
        .png({ compressionLevel: 9, palette: true, quality })
        .toBuffer()
  }
}

/**
 * Dobiera jakość do limitu wagi. Wyszukiwanie binarne po `quality`,
 * najwyżej `MAX_QUALITY_ITERATIONS` prób.
 *
 * Rzuca `EXPORT_WEIGHT_UNREACHABLE`, gdy nawet najniższa sensowna jakość
 * nie mieści się w limicie — lepsze to niż oddanie grafikowi papki.
 */
export async function exportToWeight(
  request: ExportRequest,
  ctx?: Pick<JobContext, 'onProgress' | 'logger' | 'signal'>,
  /**
   * Zakres postępu, w którym ma się zmieścić to wywołanie.
   *
   * Bez niego każdy format raportował 0→1 osobno, więc przy dwóch formatach
   * pasek szedł do końca, wracał do połowy i szedł jeszcze raz. Ten sam
   * wzorzec ma już `runFfmpeg` przez `percentFrom`/`percentTo`.
   */
  zakres: { from: number; to: number } = { from: 0, to: 1 },
): Promise<ExportOutcome> {
  const source = sharpLib(request.sourcePath).resize(request.width, request.height, {
    fit: 'cover',
    // Lanczos daje najostrzejszy wynik przy skalowaniu w górę o 1,2–1,6×,
    // czyli w zakresie, w jakim realnie pracujemy (decyzja D6).
    kernel: 'lanczos3',
  })

  let low = 30
  let high = 95
  let best: { buffer: Buffer; quality: number } | null = null
  let iterations = 0

  while (iterations < MAX_QUALITY_ITERATIONS && low <= high) {
    // Każde podejście to pełne przekodowanie obrazu, więc anulowanie ma
    // przerwać pętlę, a nie czekać na jej koniec. Typ kontekstu wprost
    // wykluczał `signal`, przez co adapter łamał kontrakt z SPEC §6:
    // zadanie anulowane w połowie eksportu mieliło dalej.
    if (ctx?.signal?.aborted === true) {
      throw new JobError('JOB_CANCELLED', 'zadanie anulowane w trakcie eksportu')
    }

    iterations += 1
    const quality = Math.floor((low + high) / 2)
    const buffer = await encode(source, request.format, quality)

    ctx?.onProgress({
      percent:
        zakres.from + ((zakres.to - zakres.from) * iterations) / MAX_QUALITY_ITERATIONS,
      phase: 'Dobieram jakość do wagi',
    })

    if (buffer.byteLength <= request.maxBytes) {
      // Mieści się — zapamiętujemy i próbujemy podnieść jakość.
      best = { buffer, quality }
      low = quality + 1
    } else {
      high = quality - 1
    }
  }

  if (best === null) {
    ctx?.logger.warn('nie da się zejść do zadanej wagi', {
      format: request.format,
      maxBytes: request.maxBytes,
      iterations,
    })
    throw new JobError('EXPORT_WEIGHT_UNREACHABLE', 'nie da się zejść do zadanej wagi')
  }

  return {
    buffer: best.buffer,
    bytes: best.buffer.byteLength,
    quality: best.quality,
    iterations,
  }
}

/** Wymiary obrazu — potrzebne przy rejestrowaniu pliku w bazie. */
export async function readDimensions(
  path: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharpLib(path).metadata()
    if (metadata.width === undefined || metadata.height === undefined) return null
    return { width: metadata.width, height: metadata.height }
  } catch {
    // Plik nie jest obrazem albo jest uszkodzony — wywołujący to obsłuży.
    return null
  }
}

/** Szerokość miniatury w siatce galerii. Jedna wartość, żeby cache miał sens. */
export const SZEROKOSC_MINIATURY = 320

/**
 * Miniatura obrazu, zapisana obok i serwowana z dysku przy kolejnym żądaniu.
 *
 * Galeria wstawiała w kafelki **pełne pliki źródłowe** — zmierzone, jedno
 * zlecenie z pięcioma klipami to 46 MB przy każdym otwarciu. Przez Funnel,
 * z telefonu, jest to nie do przyjęcia.
 *
 * WebP przy jakości 72: format ma najlepszy stosunek wagi do wyglądu przy tej
 * wielkości, a wszystkie przeglądarki, dla których panel jest budowany, go
 * czytają.
 */
export async function zrobMiniature(zrodlo: string, cel: string): Promise<Buffer> {
  const bufor = await sharpLib(zrodlo)
    .resize(SZEROKOSC_MINIATURY, null, { withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer()

  // Zapis jest optymalizacją, nie warunkiem powodzenia — gdy się nie uda,
  // następne żądanie po prostu policzy miniaturę jeszcze raz.
  await writeFile(cel, bufor).catch(() => {})

  return bufor
}
