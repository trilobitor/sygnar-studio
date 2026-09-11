import { randomInt } from 'node:crypto'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { env } from '@/lib/env'
import { videoGenerateJobSchema, type VideoGenerateJobInput } from '@/lib/schemas'
import { probeDurationMs } from '@/server/adapters/ffmpeg'
import { JobError, type JobContext } from '@/server/adapters/types'
import { generujWideo, WARIANTY_WIDEO } from '@/server/adapters/wan'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'

import { registerAsset } from './assets'
import { getOrder, touchOrder } from './orders'
import { bucketDir, buildOutputName } from './paths'

/**
 * Generowanie klipu z opisu (SPEC §12, sekcja C audytu).
 *
 * Zadanie kolejki w puli GPU, dzielonej z generowaniem obrazu — oba modele
 * nie zmieszczą się naraz w 32 GB. Przebieg trwa od pół minuty (podgląd)
 * do pięciu minut (wersja do oddania), więc grafik go zamawia i odbiera,
 * a nie czeka przy ekranie.
 */

export function enqueueVideoGenerate(input: VideoGenerateJobInput): Job {
  const job = enqueue({ orderId: input.orderId, kind: 'video_generate', params: input })
  touchOrder(input.orderId, 'active')
  void tick()
  return job
}

async function runVideoGenerate(job: Job, ctx: JobContext): Promise<void> {
  const parsed = videoGenerateJobSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'parametry zamówienia klipu nie przeszły walidacji')
  }

  const params = parsed.data
  const order = getOrder(params.orderId)
  const outputDir = bucketDir(env.STUDIO_DATA_DIR, params.orderId, 'generated')
  await mkdir(outputDir, { recursive: true })

  /*
   * Numer losowania wybiera serwer, gdy grafik go nie podał — tak samo jak
   * przy obrazie. Losowanie w przeglądarce odpadało, bo numer jest jedyną
   * rzeczą pozwalającą odtworzyć wynik i nie może zależeć od tego, co
   * przyszło z klienta.
   */
  const seed = params.seed ?? randomInt(0, 2_147_483_647)

  /*
   * Generator pisze do pliku roboczego, a pod nazwę docelową przenosimy
   * gotowy wynik. Bez tego zadanie przerwane w połowie zostawiłoby niepełny
   * klip pod właściwą nazwą, a galeria pokazałaby go jako gotowy —
   * ta sama pułapka co przy wsadzie zdjęć (SYG-004).
   */
  const roboczy = join(outputDir, `.roboczy-${job.id}.mp4`)

  ctx.onProgress({ percent: 0.02, phase: 'Ładowanie modelu' })

  try {
    await generujWideo(
      { promptEn: params.promptEn, wariant: params.wariant, seed, outputPath: roboczy },
      ctx,
    )

    const nazwa = buildOutputName({
      industry: order.industry,
      slug: 'klip',
      index: await nastepnyNumer(outputDir),
      extension: 'mp4',
    })
    const docelowy = join(outputDir, nazwa)
    await rename(roboczy, docelowy)

    const wariant = WARIANTY_WIDEO[params.wariant]

    await registerAsset({
      orderId: params.orderId,
      jobId: job.id,
      kind: 'generated',
      absolutePath: docelowy,
      mime: 'video/mp4',
      width: wariant.width,
      height: wariant.height,
      durationMs: (await probeDurationMs(docelowy).catch(() => null)) ?? undefined,
      seed,
      metadata: { promptEn: params.promptEn, wariant: params.wariant },
    })

    /*
     * Planszy nie zapisujemy jako osobnego zasobu.
     *
     * Zrobiłem tak najpierw, wzorem montażu, i było to błędem widocznym
     * dopiero na zrzucie: `Deliverables` i trasa paczki traktują `kind:
     * 'poster'` jako **plik do oddania**, więc plansza wygenerowanego klipu
     * lądowała w liście dla klienta z ostrzeżeniem, że nie wiadomo, do czego
     * służy. Przy montażu plansza faktycznie jest materiałem do oddania;
     * przy generowaniu to półprodukt.
     *
     * Miniatura i tak nie jest potrzebna: `/api/files` robi ją z klipu
     * ffmpegiem (`klatkaDoMiniatury`), bez żadnego dodatkowego wiersza.
     */
  } catch (blad) {
    // Plik roboczy nie może zostać na dysku po nieudanym albo anulowanym
    // przebiegu — inaczej katalog puchnie o niepełne klipy bez wiersza w bazie.
    await unlink(roboczy).catch(() => undefined)
    throw blad
  }

  touchOrder(params.orderId)
}

/** Kolejny wolny numer klipu w tym zleceniu. */
async function nastepnyNumer(outputDir: string): Promise<number> {
  const { readdir } = await import('node:fs/promises')
  const pliki = await readdir(outputDir).catch(() => [])
  const numery = pliki
    .map((n) => /-klip-(\d+)\.mp4$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))

  return numery.length === 0 ? 1 : Math.max(...numery) + 1
}

registerRunner('video_generate', runVideoGenerate)
