import { NextResponse } from 'next/server'

import {
  exportJobSchema,
  generateJobSchema,
  photoBatchSchema,
  videoJobSchema,
} from '@/lib/schemas'
import { fail, handleError } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { getJob, positionInQueue } from '@/server/queue/store'
import { enqueueExport } from '@/server/services/export'
import { enqueueGeneration } from '@/server/services/generation'
import { enqueuePhotoBatch } from '@/server/services/photo-batch'
import { enqueueVideo } from '@/server/services/video'

export const dynamic = 'force-dynamic'

/**
 * Powtórzenie zadania z zapisanymi parametrami.
 *
 * Nieudanego zadania nie dało się powtórzyć: grafik musiał otworzyć brief od
 * nowa i wpisać wszystko ręcznie, choć parametry leżały w `params_json`.
 * Przy awarii przejściowej — pełny dysk, zwolniona stacja — była to praca
 * odtwarzana od zera bez powodu.
 *
 * Parametry przepuszczamy przez schemat mimo tego, że kiedyś już przez niego
 * przeszły: wiersz mógł powstać w starszej wersji aplikacji, a baza nie jest
 * źródłem zaufania (SPEC §13).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params
    const job = getJob(id)

    if (job === undefined) return fail('NOT_FOUND', 404)

    const params: unknown = JSON.parse(job.paramsJson)

    switch (job.kind) {
      case 'image_generate': {
        // Świeże numery losowania: powtórzenie z tymi samymi dałoby dokładnie
        // ten sam kadr, a powtarzamy zwykle dlatego, że poprzedni nie wyszedł.
        const wejscie = generateJobSchema.parse(params)
        const nowe = enqueueGeneration({ ...wejscie, seeds: undefined })
        return NextResponse.json({ jobId: nowe.id, position: positionInQueue(nowe) }, { status: 202 })
      }
      case 'image_export': {
        const nowe = enqueueExport(exportJobSchema.parse(params))
        return NextResponse.json({ jobId: nowe.id, position: positionInQueue(nowe) }, { status: 202 })
      }
      case 'video_render': {
        const nowe = enqueueVideo(videoJobSchema.parse(params))
        return NextResponse.json({ jobId: nowe.id, position: positionInQueue(nowe) }, { status: 202 })
      }
      case 'photo_batch': {
        const nowe = enqueuePhotoBatch(photoBatchSchema.parse(params))
        return NextResponse.json({ jobId: nowe.id, position: positionInQueue(nowe) }, { status: 202 })
      }
      default:
        return fail('VALIDATION_FAILED', 400)
    }
  } catch (error) {
    return handleError(error, 'POST /api/jobs/[id]/ponow')
  }
}
