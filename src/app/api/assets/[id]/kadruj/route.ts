import { NextResponse } from 'next/server'

import { cropSchema } from '@/lib/schemas'
import { handleError } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { cropAsset } from '@/server/services/crop'

export const dynamic = 'force-dynamic'

/**
 * Przycięcie kadru do zaznaczonego prostokąta.
 *
 * Osobna trasa zamiast zadania w kolejce: `sharp.extract()` trwa milisekundy,
 * a pasek postępu przy takiej operacji jest tylko hałasem. Odpowiedź niesie
 * gotowy zasób, więc panel pokazuje nowy kadr od razu.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params
    const body: unknown = await request.json()

    const asset = await cropAsset(id, cropSchema.parse(body))

    return NextResponse.json({ asset }, { status: 201 })
  } catch (error) {
    return handleError(error, 'POST /api/assets/[id]/kadruj')
  }
}
