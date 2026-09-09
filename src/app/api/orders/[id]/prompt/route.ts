import { NextResponse } from 'next/server'

import { createLogger } from '@/lib/logger'
import { getPreset } from '@/lib/output-presets'
import { briefSchema } from '@/lib/schemas'
import { handleError, tooMany } from '@/server/api/respond'
import { clientKey, consume, PROMPT_LIMIT } from '@/server/services/rate-limit'
import { ensureStarted } from '@/server/bootstrap'
import { getOrder, saveBrief } from '@/server/services/orders'
import { briefToPrompt } from '@/server/services/prompt'

export const dynamic = 'force-dynamic'

/**
 * Brief po polsku → opis sceny po angielsku (SPEC §8).
 *
 * Nie zwraca błędu, gdy zabraknie modelu językowego — wtedy opis składa
 * deterministyczny składacz, a odpowiedź niesie `source` i `needsTranslation`,
 * żeby interfejs wiedział, co pokazać grafikowi.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params

  try {
    ensureStarted()

    // Warstwa promptowa kosztuje limity subskrypcji, więc też ma zaporę.
    const decision = consume(clientKey(request, 'prompt'), PROMPT_LIMIT)
    if (!decision.allowed) return tooMany(decision.retryAfterSeconds)

    const order = getOrder(id)

    const body: unknown = await request.json()
    const brief = briefSchema.parse(body)
    const preset = getPreset(brief.purpose)

    saveBrief(id, brief)

    const outcome = await briefToPrompt(brief, order, createLogger({ orderId: id }))

    return NextResponse.json({
      promptEn: outcome.promptEn,
      assumptions: outcome.assumptions,
      source: outcome.source,
      needsTranslation: outcome.needsTranslation,
      dimensions: preset.generate,
      purpose: brief.purpose,
    })
  } catch (error) {
    return handleError(error, 'POST /api/orders/[id]/prompt')
  }
}
