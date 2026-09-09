import { NextResponse } from 'next/server'

import { fail, handleError } from '@/server/api/respond'
import { ensureStarted } from '@/server/bootstrap'
import { getJob, positionInQueue } from '@/server/queue/store'
import { cancelJob } from '@/server/queue/worker'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    const { id } = await context.params
    const job = getJob(id)

    if (job === undefined) return fail('NOT_FOUND', 404)

    return NextResponse.json({
      job,
      position: job.status === 'queued' ? positionInQueue(job) : 0,
    })
  } catch (error) {
    return handleError(error, 'GET /api/jobs/[id]')
  }
}

/** Anulowanie zadania — przez `AbortController` przekazany do adaptera. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    const { id } = await context.params
    const job = getJob(id)

    if (job === undefined) return fail('NOT_FOUND', 404)

    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      // Zadanie już się skończyło — anulowanie nic nie zmienia, ale to nie błąd.
      return NextResponse.json({ cancelled: false, status: job.status })
    }

    cancelJob(id)
    return NextResponse.json({ cancelled: true })
  } catch (error) {
    return handleError(error, 'DELETE /api/jobs/[id]')
  }
}
