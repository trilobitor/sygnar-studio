import { NextResponse } from 'next/server'

import { handleError } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { listPromptRuns } from '@/server/services/orders'

export const dynamic = 'force-dynamic'

/**
 * Historia opisów przygotowanych dla zlecenia.
 *
 * `prompt_runs` była tabelą tylko do zapisu: rygor C wymagał zapisywania
 * każdego wywołania modelu razem z kosztem, ale nikt tych wierszy nie czytał.
 * Zapis, którego nikt nie ogląda, nie jest kontrolą — jest kosztem.
 *
 * Zwracamy bez `briefJson`: to kopia makiety, którą panel i tak ma z osobnej
 * tabeli, a odpowiedź nie musi jej nieść drugi raz.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params

    return NextResponse.json({ opisy: listPromptRuns(id, 20) })
  } catch (error) {
    return handleError(error, 'GET /api/orders/[id]/opisy')
  }
}
