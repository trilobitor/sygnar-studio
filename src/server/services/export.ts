import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { env } from '@/lib/env'
import { getPreset } from '@/lib/output-presets'
import { exportJobSchema, type ExportJobInput } from '@/lib/schemas'
import { exportToWeight, type ExportFormat } from '@/server/adapters/sharp'
import { JobError, type JobContext } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'
import { assetFilePath, getAsset, registerAsset } from './assets'
import { getOrder, listAssets, touchOrder } from './orders'
import { bucketDir, buildOutputName } from './paths'

/**
 * Eksport obrazów do limitów wagi (SPEC §6, etap E4).
 *
 * Wymiar docelowy i limit wagi biorą się z presetu (decyzja D7), a nie
 * z tego, co przyśle klient. Klient wybiera preset, nie liczby.
 */

const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  png: 'image/png',
  jpeg: 'image/jpeg',
}

export function enqueueExport(input: ExportJobInput): Job {
  const job = enqueue({ orderId: input.orderId, kind: 'image_export', params: input })
  void tick()
  return job
}

async function runExport(job: Job, ctx: JobContext): Promise<void> {
  const parsed = exportJobSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    // Nie `COMFY_WORKFLOW_INVALID`: ten kod mapuje się na komunikat
    // „coś jest nie tak z ustawieniami **generowania**", a grafik właśnie
    // eksportował gotowy kadr i szukałby błędu zupełnie gdzie indziej.
    throw new JobError('EXPORT_FAILED', 'parametry eksportu nie przeszły walidacji')
  }

  const params = parsed.data
  const preset = getPreset(params.purpose)
  const order = getOrder(params.orderId)
  const source = getAsset(params.assetId)
  const sourcePath = assetFilePath(source)

  const maxBytes = (params.maxWeightKb ?? preset.maxWeightKb) * 1024
  const outputDir = bucketDir(env.STUDIO_DATA_DIR, params.orderId, 'exports')

  // Numer pliku rośnie w obrębie slotu, żeby nazwy się nie zderzały.
  // Jeden eksport daje tyle plików, ile formatów ma preset, więc liczbę
  // dotychczasowych plików dzielimy przez tę liczbę.
  //
  // Sam licznik nie wystarcza: dwa eksporty tego samego slotu mogą biec
  // równolegle (`NON_GPU_CONCURRENCY` to 2) i oba policzą tyle samo plików,
  // bo żaden jeszcze niczego nie zapisał. Numer jest więc punktem wyjścia,
  // a nie rozstrzygnięciem — `zajmijNazwe` szuka dalej pierwszej wolnej.
  const index = Math.floor(countExports(params.orderId, params.purpose) / preset.formats.length) + 1

  let step = 0
  for (const format of preset.formats) {
    step += 1
    ctx.onProgress({
      percent: (step - 1) / preset.formats.length,
      phase: `Zapisuję plik ${step} z ${preset.formats.length}`,
    })

    const outcome = await exportToWeight(
      {
        sourcePath,
        format,
        width: preset.deliver.width,
        height: preset.deliver.height,
        maxBytes,
      },
      ctx,
    )

    const { absolutePath } = await zajmijNazwe({
      outputDir,
      industry: order.industry,
      slug: preset.slug,
      index,
      extension: format,
    })

    await writeFile(absolutePath, outcome.buffer)

    await registerAsset({
      orderId: params.orderId,
      jobId: job.id,
      kind: 'export',
      absolutePath,
      mime: MIME_BY_FORMAT[format],
      width: preset.deliver.width,
      height: preset.deliver.height,
      seed: source.seed ?? undefined,
      metadata: {
        purpose: params.purpose,
        quality: outcome.quality,
        iterations: outcome.iterations,
        maxWeightKb: maxBytes / 1024,
        sourceAssetId: source.id,
      },
    })

    ctx.logger.info('zapisano eksport', {
      format,
      bytes: outcome.bytes,
      quality: outcome.quality ?? -1,
    })
  }

  touchOrder(params.orderId)
}

/**
 * Rezerwuje pierwszą wolną nazwę, tworząc pusty plik z flagą `wx`.
 *
 * `wx` zawodzi, gdy plik już istnieje, i robi to **atomowo** — dwa równoległe
 * eksporty nie mogą dostać tej samej nazwy. Sprawdzenie „czy istnieje", a potem
 * zapis, zostawiałoby okno pomiędzy jednym a drugim.
 */
async function zajmijNazwe(parts: {
  outputDir: string
  industry: string | null
  slug: string
  index: number
  extension: string
}): Promise<{ fileName: string; absolutePath: string }> {
  // Sufit na wypadek, gdyby coś poszło nie tak — lepiej błąd niż pętla bez końca.
  for (let numer = parts.index; numer < parts.index + 1000; numer += 1) {
    const fileName = buildOutputName({
      industry: parts.industry,
      slug: parts.slug,
      index: numer,
      extension: parts.extension,
    })
    const absolutePath = join(parts.outputDir, fileName)

    try {
      const uchwyt = await open(absolutePath, 'wx')
      await uchwyt.close()
      return { fileName, absolutePath }
    } catch (error) {
      const kod: unknown = Reflect.get(error as object, 'code')
      if (kod !== 'EEXIST') throw error
    }
  }

  throw new JobError('EXPORT_FAILED', 'nie udało się znaleźć wolnej nazwy pliku')
}

/** Ile plików eksportu powstało już w tym zleceniu dla tego slotu. */
function countExports(orderId: string, purpose: string): number {
  return listAssets(orderId).filter((asset) => {
    if (asset.kind !== 'export' || asset.metadataJson === null) return false
    const parsed: unknown = JSON.parse(asset.metadataJson)
    if (typeof parsed !== 'object' || parsed === null) return false
    return Reflect.get(parsed, 'purpose') === purpose
  }).length
}

registerRunner('image_export', runExport)
