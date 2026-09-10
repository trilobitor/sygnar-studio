import { NextResponse } from 'next/server'
import { z } from 'zod'

import { fail, handleError } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { deleteAsset, getAsset, setStarred } from '@/server/services/assets'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({ starred: z.boolean() })

/**
 * Odłożenie kadru na bok i kasowanie pojedynczego pliku.
 *
 * Kolumna `starred` istniała w bazie od pierwszej migracji i nie miała ani
 * endpointu, ani interfejsu — grafik nie mógł oznaczyć wybranego kadru, więc
 * przy ośmiu wariantach musiał go zapamiętać albo zapisać numer losowania
 * gdzieś obok.
 *
 * Kasowania też nie było: odrzucone kadry i nieudane eksporty zostawały
 * w galerii na zawsze, a katalog rósł bez sposobu na sprzątanie z poziomu
 * panelu.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params
    const body: unknown = await request.json()
    const parsed = patchSchema.safeParse(body)

    if (!parsed.success) return fail('VALIDATION_FAILED', 400)

    // `getAsset` rzuca NOT_FOUND, więc nieistniejący plik nie przechodzi dalej.
    getAsset(id)
    setStarred(id, parsed.data.starred)

    return NextResponse.json({ starred: parsed.data.starred })
  } catch (error) {
    return handleError(error, 'PATCH /api/assets/[id]')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params
    await deleteAsset(id)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    return handleError(error, 'DELETE /api/assets/[id]')
  }
}
