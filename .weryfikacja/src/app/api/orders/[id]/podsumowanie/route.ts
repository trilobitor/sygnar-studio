import { NextResponse } from 'next/server'

import { handleError } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { summarizeOrder } from '@/server/services/orders'

export const dynamic = 'force-dynamic'

/**
 * Liczby do wyceny zlecenia: kadry, pliki do oddania, czas stacji i zużycie
 * warstwy promptowej.
 *
 * Osobna trasa, a nie pole w `GET /api/orders/[id]`, bo szczegół zlecenia
 * jest odpytywany przy każdej zmianie w kolejce, a te agregaty są potrzebne
 * dopiero wtedy, gdy grafik rozwinie blok podsumowania.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params

    return NextResponse.json({ podsumowanie: summarizeOrder(id) })
  } catch (error) {
    return handleError(error, 'GET /api/orders/[id]/podsumowanie')
  }
}
