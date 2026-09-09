import { NextResponse } from 'next/server'

import { createOrderSchema } from '@/lib/schemas'
import { ensureStarted } from '@/server/bootstrap'
import { handleError } from '@/server/api/respond'
import { createOrder, listOrders } from '@/server/services/orders'

export const dynamic = 'force-dynamic'

/** Lista zleceń, limit 50 (SPEC §8). */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    ensureStarted()

    // `?archiwalne` dokłada zlecenia odłożone do archiwum. Bez tego parametru
    // lista pokazuje wyłącznie te, nad którymi się pracuje.
    const zArchiwalnymi = new URL(request.url).searchParams.has('archiwalne')

    return NextResponse.json({ orders: listOrders(50, zArchiwalnymi) })
  } catch (error) {
    return handleError(error, 'GET /api/orders')
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    ensureStarted()
    const body: unknown = await request.json()
    const input = createOrderSchema.parse(body)
    const order = await createOrder(input)
    return NextResponse.json({ order }, { status: 201 })
  } catch (error) {
    return handleError(error, 'POST /api/orders')
  }
}
