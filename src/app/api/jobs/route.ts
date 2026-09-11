import { NextResponse } from 'next/server'

import {
  exportJobSchema,
  generateJobSchema,
  imageEditSchema,
  jobKindSchema,
  photoBatchSchema,
  videoGenerateJobSchema,
  videoJobSchema,
} from '@/lib/schemas'
import { handleError, fail, tooMany } from '@/server/api/respond'
import { clientKey, consume, JOB_LIMIT } from '@/server/services/rate-limit'
import { ensureStarted } from '@/server/bootstrap'
import { enqueueEdit } from '@/server/services/edit'
import { listJobs, positionInQueue } from '@/server/queue/store'
import { enqueueExport } from '@/server/services/export'
import { enqueueGeneration } from '@/server/services/generation'
import { enqueuePhotoBatch } from '@/server/services/photo-batch'
import { enqueueVideo } from '@/server/services/video'
import { enqueueVideoGenerate } from '@/server/services/video-generate'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    ensureStarted()
    return NextResponse.json({ jobs: listJobs(50) })
  } catch (error) {
    return handleError(error, 'GET /api/jobs')
  }
}

/** Dodanie zadania do kolejki, zwraca `jobId` (SPEC §8). */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    ensureStarted()

    // Endpoint uruchamiający minuty pracy GPU jest celem do wyczerpania
    // zasobów (SPEC §13), więc limit stoi przed walidacją, nie za nią.
    const decision = consume(clientKey(request, 'zadania'), JOB_LIMIT)
    if (!decision.allowed) return tooMany(decision.retryAfterSeconds)

    const body: unknown = await request.json()

    if (typeof body !== 'object' || body === null || !('kind' in body)) {
      return fail('VALIDATION_FAILED', 400)
    }

    // Rodzaj zadania przechodzi przez schemat, a nie przez ręczne porównania
    // z nieznanym typem: dzięki temu kompilator pilnuje, że switch obsługuje
    // każdy rodzaj z listy, a nowy rodzaj nie przejdzie niezauważony.
    const kind = jobKindSchema.safeParse(Reflect.get(body, 'kind'))

    if (!kind.success) return fail('VALIDATION_FAILED', 400)

    switch (kind.data) {
      case 'image_generate': {
        const job = enqueueGeneration(generateJobSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      case 'image_edit': {
        const job = enqueueEdit(imageEditSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      case 'image_export': {
        const job = enqueueExport(exportJobSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      case 'video_generate': {
        const job = enqueueVideoGenerate(videoGenerateJobSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      case 'video_render': {
        const job = enqueueVideo(videoJobSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      case 'photo_batch': {
        const job = enqueuePhotoBatch(photoBatchSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      default:
        return fail('VALIDATION_FAILED', 400)
    }
  } catch (error) {
    return handleError(error, 'POST /api/jobs')
  }
}
