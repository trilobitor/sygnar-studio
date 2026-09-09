import { NextResponse } from 'next/server'

import { exportJobSchema, generateJobSchema, photoBatchSchema, videoJobSchema } from '@/lib/schemas'
import { handleError, fail, tooMany } from '@/server/api/respond'
import { clientKey, consume, JOB_LIMIT } from '@/server/services/rate-limit'
import { ensureStarted } from '@/server/bootstrap'
import { listJobs, positionInQueue } from '@/server/queue/store'
import { enqueueExport } from '@/server/services/export'
import { enqueueGeneration } from '@/server/services/generation'
import { enqueuePhotoBatch } from '@/server/services/photo-batch'
import { enqueueVideo } from '@/server/services/video'

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

    const kind: unknown = Reflect.get(body, 'kind')

    switch (kind) {
      case 'image_generate': {
        const job = enqueueGeneration(generateJobSchema.parse(body))
        return NextResponse.json({ jobId: job.id, position: positionInQueue(job) }, { status: 202 })
      }
      case 'image_export': {
        const job = enqueueExport(exportJobSchema.parse(body))
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
