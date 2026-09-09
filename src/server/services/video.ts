import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { env } from '@/lib/env'
import { videoJobSchema, type VideoJobInput } from '@/lib/schemas'
import {
  extractPoster,
  probeDurationMs,
  render,
  type VideoOperation,
} from '@/server/adapters/ffmpeg'
import { JobError, type JobContext } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'
import { assetFilePath, getOrderAsset, registerAsset } from './assets'
import { getOrder, touchOrder } from './orders'
import { bucketDir, buildOutputName } from './paths'

/**
 * Montaż wideo (SPEC §6, etap E5).
 *
 * Z wgranego klipu powstaje pętla w wybranym kadrze, w dwóch formatach,
 * z planszą. Przy awarii w połowie plik częściowy jest usuwany — grafik
 * nie może dostać w galerii pliku, który się nie otworzy.
 */

export function enqueueVideo(input: VideoJobInput): Job {
  const job = enqueue({ orderId: input.orderId, kind: 'video_render', params: input })
  touchOrder(input.orderId, 'active')
  void tick()
  return job
}

async function runVideo(job: Job, ctx: JobContext): Promise<void> {
  const parsed = videoJobSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    throw new JobError('FFMPEG_FAILED', 'parametry montażu nie przeszły walidacji')
  }

  const params = parsed.data
  const order = getOrder(params.orderId)
  // Plik musi należeć do tego zlecenia — inaczej dało się zamówić montaż
  // albo eksport cudzego pliku, podając własne `orderId`.
  const source = getOrderAsset(params.orderId, params.assetId)
  const sourcePath = assetFilePath(source)
  const outputDir = bucketDir(env.STUDIO_DATA_DIR, params.orderId, 'exports')

  const baseName = buildOutputName({
    industry: order.industry,
    slug: 'video',
    index: await nastepnyNumer(outputDir, order.industry),
    extension: 'mp4',
  }).replace(/\.mp4$/, '')

  const mp4Path = join(outputDir, `${baseName}.mp4`)
  const webmPath = join(outputDir, `${baseName}.webm`)
  const posterPath = join(outputDir, `${baseName}-plansza.jpg`)

  // Lista plików, które trzeba sprzątnąć, jeśli coś pójdzie nie tak w połowie.
  const partial: string[] = []

  try {
    ctx.onProgress({ percent: 0, phase: 'Czytam klip' })

    await pilnujDlugosciPetli(sourcePath, params.operations)

    const targetBytes = params.targetMb * 1024 * 1024

    partial.push(mp4Path)
    await render(
      {
        sourcePath,
        outputPath: mp4Path,
        operations: params.operations,
        targetBytes,
        codec: 'h264',
      },
      ctx,
      { from: 0.05, to: 0.5 },
    )

    partial.push(webmPath)
    await render(
      {
        sourcePath,
        outputPath: webmPath,
        operations: params.operations,
        targetBytes,
        codec: 'av1',
      },
      ctx,
      { from: 0.5, to: 0.9 },
    )

    if (params.poster) {
      partial.push(posterPath)
      await extractPoster(mp4Path, posterPath, ctx)
    }

    const durationMs = await probeDurationMs(mp4Path)

    await registerAsset({
      orderId: params.orderId,
      jobId: job.id,
      kind: 'export',
      absolutePath: mp4Path,
      mime: 'video/mp4',
      durationMs: durationMs ?? undefined,
      metadata: { sourceAssetId: source.id, operations: params.operations },
    })

    await registerAsset({
      orderId: params.orderId,
      jobId: job.id,
      kind: 'export',
      absolutePath: webmPath,
      mime: 'video/webm',
      durationMs: durationMs ?? undefined,
      metadata: { sourceAssetId: source.id, operations: params.operations },
    })

    if (params.poster) {
      await registerAsset({
        orderId: params.orderId,
        jobId: job.id,
        kind: 'poster',
        absolutePath: posterPath,
        mime: 'image/jpeg',
        metadata: { sourceAssetId: source.id },
      })
    }

    ctx.onProgress({ percent: 1, phase: 'Gotowe' })
    touchOrder(params.orderId)
  } catch (error) {
    // Plik częściowy usuwamy, ale błąd leci dalej — nie połykamy go.
    for (const path of partial) {
      await rm(path, { force: true })
    }
    ctx.logger.warn('usunięto pliki częściowe po nieudanym montażu', {
      count: partial.length,
    })
    throw error
  }
}

/**
 * Maksymalny odcinek, jaki wolno zapętlić.
 *
 * Filtr `reverse` trzyma **cały** odwracany materiał w pamięci — zmierzone
 * na tej maszynie: 1,99 GB dla 20 s w 1080p, czyli około 100 MB na sekundę.
 * Nic tego wcześniej nie ograniczało: przy limicie wgrania 100 MB da się
 * przysłać klip na kilka minut, a jego zapętlenie sięgnęłoby dziesiątek
 * gigabajtów i położyło maszynę.
 *
 * Piętnaście sekund to zapas nad pętlą 10-sekundową, o której mówi SPEC §679.
 */
export const MAX_PETLA_MS = 15_000

/**
 * Odrzuca montaż, którego pętla nie zmieści się w pamięci.
 *
 * Liczymy odcinek **po przycięciu**, bo to on trafia do `reverse` — grafik
 * może zapętlić 8 sekund wyciętych z dziesięciominutowego materiału i to jest
 * w porządku.
 */
async function pilnujDlugosciPetli(
  sourcePath: string,
  operations: readonly VideoOperation[],
): Promise<void> {
  const petla = operations.some((o) => o.kind === 'loop' && o.pingPong)
  if (!petla) return

  const trim = operations.find((o) => o.kind === 'trim')

  if (trim !== undefined && trim.kind === 'trim') {
    if (trim.endMs - trim.startMs > MAX_PETLA_MS) {
      throw new JobError(
        'FFMPEG_FAILED',
        `pętla dłuższa niż ${MAX_PETLA_MS / 1000} s nie zmieści się w pamięci`,
      )
    }
    return
  }

  // Bez przycięcia zapętlamy całość, więc decyduje długość materiału.
  const dlugosc = await probeDurationMs(sourcePath)

  if (dlugosc !== null && dlugosc > MAX_PETLA_MS) {
    throw new JobError(
      'FFMPEG_FAILED',
      `klip ma ${Math.round(dlugosc / 1000)} s, a pętla bez przycięcia mieści ${MAX_PETLA_MS / 1000} s`,
    )
  }
}

/**
 * Kolejny wolny numer montażu w zleceniu.
 *
 * Numer był wpisany na sztywno jako 1, więc drugi montaż w tym samym zleceniu
 * nadpisywał pliki pierwszego — bez ostrzeżenia i bez śladu w bazie. Pytamy
 * katalog, a nie bazę, bo przy kolizji ginie plik na dysku.
 */
async function nastepnyNumer(outputDir: string, industry: string | null): Promise<number> {
  const prefiks = industry === null ? 'sygnar' : industry
  const wzor = new RegExp(`^${prefiks}-video-(\\d+)\\.mp4$`)

  let najwyzszy = 0

  try {
    for (const nazwa of await readdir(outputDir)) {
      const trafienie = wzor.exec(nazwa)
      if (trafienie?.[1] === undefined) continue
      najwyzszy = Math.max(najwyzszy, Number.parseInt(trafienie[1], 10))
    }
  } catch {
    // Katalogu jeszcze nie ma — to pierwszy montaż w tym zleceniu.
  }

  return najwyzszy + 1
}

registerRunner('video_render', runVideo)
