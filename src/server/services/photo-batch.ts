import { open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { env, hasDarktable } from '@/lib/env'
import { applyPreset } from '@/server/adapters/darktable'
import { readDimensions } from '@/server/adapters/sharp'
import { JobError, type JobContext } from '@/server/adapters/types'
import { photoBatchSchema, type PhotoBatchInput } from '@/lib/schemas'
import type { Job } from '@/server/db/schema'
import { enqueue } from '@/server/queue/store'
import { registerRunner, tick } from '@/server/queue/worker'
import { assetFilePath, getOrderAsset, registerAsset } from './assets'
import { getOrder, touchOrder } from './orders'
import { bucketDir, buildOutputName } from './paths'

/**
 * Wsadowa obróbka zdjęć presetem darktable (SPEC §6, etap E6).
 *
 * [NIEPOTWIERDZONE] darktable prawdopodobnie nie znosi równoległych uruchomień
 * przez blokadę biblioteki. Do czasu weryfikacji wywołania idą jedno po drugim
 * — i to pilnowane jest w **dwóch** miejscach, bo jedno nie wystarczało:
 * pętla niżej serializuje zdjęcia w obrębie wsadu, a pula `PHOTO_JOB_KINDS`
 * w workerze (pojemność 1) serializuje same wsady. Wcześniej `photo_batch`
 * siedział w puli nie-GPU o pojemności dwa i dwa wsady startowały równocześnie.
 *
 * Nazwy plików rezerwujemy przez wyłączne utworzenie pliku, a darktable pisze
 * najpierw do pliku roboczego. Bez tego drugi wsad w tym samym zleceniu
 * zaczynał numerację od nowa, darktable dopisywał `_01` obok, a wiersz w bazie
 * wskazywał na plik z pierwszego wsadu (SYG-004, SYG-006).
 */

/**
 * Rezerwuje pierwszą wolną nazwę `<branza>-zdjecia-NN.jpg` przez wyłączne
 * utworzenie pliku. Odpowiednik `zajmijNazwe` z `export.ts`, którego wsad nie
 * używał — i dlatego dwa wsady w jednym zleceniu zderzały się nazwami.
 */
async function zajmijNazwe(parts: {
  outputDir: string
  industry: string | null
  index: number
}): Promise<string> {
  // Sufit na wypadek, gdyby coś poszło nie tak — lepiej błąd niż pętla bez końca.
  for (let numer = parts.index; numer < parts.index + 1000; numer += 1) {
    const sciezka = join(
      parts.outputDir,
      buildOutputName({
        industry: parts.industry,
        slug: 'zdjecia',
        index: numer,
        extension: 'jpg',
      }),
    )

    try {
      const uchwyt = await open(sciezka, 'wx')
      await uchwyt.close()
      return sciezka
    } catch (error) {
      const kod: unknown = Reflect.get(error as object, 'code')
      if (kod !== 'EEXIST') throw error
    }
  }

  throw new JobError('EXPORT_FAILED', 'nie udało się znaleźć wolnej nazwy pliku')
}

export function enqueuePhotoBatch(input: PhotoBatchInput): Job {
  const job = enqueue({ orderId: input.orderId, kind: 'photo_batch', params: input })
  void tick()
  return job
}

async function runPhotoBatch(job: Job, ctx: JobContext): Promise<void> {
  if (!hasDarktable) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'darktable nie jest skonfigurowany')
  }

  const parsed = photoBatchSchema.safeParse(JSON.parse(job.paramsJson))

  if (!parsed.success) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'parametry wsadu nie przeszły walidacji')
  }

  const params = parsed.data
  const outputDir = bucketDir(env.STUDIO_DATA_DIR, params.orderId, 'exports')

  /*
   * Preset i zdjęcia muszą należeć do **tego** zlecenia. `getAsset` brał plik
   * po samym identyfikatorze, więc wsad potrafił wciągnąć cudzy plik i wstawić
   * go do plików do oddania zamawiającego (SYG-007). Eksport i montaż używały
   * `getOrderAsset` od początku — wsad był jedynym miejscem bez tej granicy.
   */
  const presetPath =
    params.presetXmpAssetId === undefined
      ? null
      : assetFilePath(getOrderAsset(params.orderId, params.presetXmpAssetId))

  const order = getOrder(params.orderId)

  /*
   * Numerację prowadzimy przez cały wsad, żeby pliki wyszły jako
   * `<branza>-zdjecia-01.jpg`, `-02`, `-03`. Wcześniej nazwą był identyfikator
   * zasobu — dla grafika, który te pliki oddaje klientowi, taka nazwa nie
   * niesie żadnej informacji, a przy dwustu zdjęciach nie da się ich odróżnić.
   */
  let done = 0

  /*
   * Numer startowy bierzemy z tego, co już leży w katalogu, a nie z zera.
   * `zajmijNazwe` i tak przeskoczy zajęte numery, ale bez tego każdy kolejny
   * wsad zaczynałby od szukania numeru 1 i przebiegał całą dotychczasową
   * numerację od nowa.
   */
  let kolejny = 1

  for (const assetId of params.assetIds) {
    if (ctx.signal.aborted) {
      throw new JobError('JOB_CANCELLED', 'zadanie anulowane')
    }

    const source = getOrderAsset(params.orderId, assetId)
    const sourcePath = assetFilePath(source)

    /*
     * darktable pisze najpierw do pliku roboczego, dopiero potem przenosimy
     * go pod zarezerwowaną nazwę.
     *
     * Prosta rezerwacja — utworzenie pustego pliku docelowego — tu nie
     * zadziała: darktable-cli **nie nadpisuje** istniejącego pliku, tylko
     * dopisuje obok `_01`. Zmierzone 11.09.2026 na prawdziwym przebiegu:
     * drugi wsad w tym samym zleceniu zostawił `legal-zdjecia-01_01.jpg`
     * na dysku, a wiersz w bazie wskazał na plik pierwszego wsadu.
     */
    const roboczy = join(outputDir, `.roboczy-${randomUUID()}.jpg`)

    await applyPreset({ sourcePath, presetPath, outputPath: roboczy }, ctx)

    const outputPath = await zajmijNazwe({
      outputDir,
      industry: order.industry,
      index: kolejny,
    })

    // `rename` w obrębie jednego systemu plików jest niepodzielne i nadpisuje
    // pustą rezerwację, więc nie ma okna, w którym nazwa jest wolna.
    await rename(roboczy, outputPath).catch(async (blad: unknown) => {
      await unlink(roboczy).catch(() => undefined)
      throw blad
    })

    /*
     * Wymiary czytamy z gotowego pliku. Bez nich kontrola przed oddaniem nie
     * ma czego sprawdzić, a panel „Do oddania" pokazuje puste miejsce zamiast
     * rozmiaru — sprawdzone na pierwszym prawdziwym przebiegu wsadu.
     */
    const wymiary = await readDimensions(outputPath)

    await registerAsset({
      orderId: params.orderId,
      jobId: job.id,
      kind: 'export',
      absolutePath: outputPath,
      mime: 'image/jpeg',
      width: wymiary?.width,
      height: wymiary?.height,
      metadata: {
        sourceAssetId: source.id,
        preset: params.presetXmpAssetId ?? null,
        hasAlpha: wymiary?.hasAlpha ?? false,
      },
    })

    done += 1
    kolejny += 1
    ctx.onProgress({
      percent: done / params.assetIds.length,
      phase: `Obrabiam zdjęcie ${done} z ${params.assetIds.length}`,
    })
  }

  touchOrder(params.orderId)
}

registerRunner('photo_batch', runPhotoBatch)
