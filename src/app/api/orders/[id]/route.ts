import { NextResponse } from 'next/server'

import { renameOrderSchema } from '@/lib/schemas'
import { handleError } from '@/server/api/respond'
import { ensureStarted } from '@/server/bootstrap'
import { listJobsForOrder } from '@/server/queue/store'
import { cancelJob, poczekajNaZatrzymanie } from '@/server/queue/worker'
import { deleteOrder, getOrder, latestBrief, listAssets, renameOrder } from '@/server/services/orders'

export const dynamic = 'force-dynamic'

/** Zlecenie razem z plikami i zadaniami (SPEC §8). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    const { id } = await context.params

    return NextResponse.json({
      order: getOrder(id),
      // `path` skracamy do samej nazwy pliku, a `paramsJson` odcinamy —
      // klient nie potrzebuje ani układu katalogów na dysku, ani parametrów
      // wywołania generatora. Odpowiedź API nie musi ich nieść tylko dlatego,
      // że wiersz w bazie je ma.
      assets: listAssets(id).map((a) => ({ ...a, path: a.path.split('/').pop() ?? a.path })),
      jobs: listJobsForOrder(id, 20).map((job) => {
        const { paramsJson, ...reszta } = job
        void paramsJson
        return reszta
      }),
      brief: latestBrief(id),
    })
  } catch (error) {
    return handleError(error, 'GET /api/orders/[id]')
  }
}

/** Zmiana nazwy zlecenia. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    const { id } = await context.params

    const body: unknown = await request.json()
    const input = renameOrderSchema.parse(body)

    return NextResponse.json({ order: renameOrder(id, input.name) })
  } catch (error) {
    return handleError(error, 'PATCH /api/orders/[id]')
  }
}

/**
 * Usunięcie zlecenia razem z kadrami, eksportami i historią.
 * Operacja jest nieodwracalna — interfejs pyta o potwierdzenie przed nią.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    const { id } = await context.params

    // Zadanie w toku pisze do katalogu, który za chwilę zniknie —
    // najpierw je zatrzymujemy, dopiero potem kasujemy.
    //
    // Samo `cancelJob` tylko sygnalizuje przerwanie: proces mfluxa albo
    // ffmpega kończy się chwilę później i potrafi dopisać plik do katalogu
    // już usuniętego. Dlatego czekamy, aż faktycznie staną.
    const zatrzymywane: string[] = []

    for (const job of listJobsForOrder(id, 50)) {
      if (job.status === 'queued' || job.status === 'running') {
        cancelJob(job.id)
        zatrzymywane.push(job.id)
      }
    }

    await poczekajNaZatrzymanie(zatrzymywane)
    await deleteOrder(id)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    return handleError(error, 'DELETE /api/orders/[id]')
  }
}
