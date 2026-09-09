import { NextResponse } from 'next/server'

import { logger } from '@/lib/logger'
import { collectHealth } from '@/server/services/health'

/**
 * Stan adapterów pod baner w interfejsie (SPEC §8).
 * Sprawdzenie dotyka dysku i uruchamia binarki, więc nigdy nie cache'ujemy.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const report = await collectHealth()

    logger.debug('sprawdzono stan adapterów', {
      ready: report.ready,
      unavailable: report.adapters
        .filter((adapter) => !adapter.status.ok)
        .map((adapter) => adapter.name)
        .join(',') || 'brak',
    })

    return NextResponse.json(report)
  } catch (error) {
    // Błąd jest obsłużony i zalogowany, nigdy połknięty w milczeniu.
    logger.error('nie udało się sprawdzić stanu adapterów', {
      cause: error instanceof Error ? error.message : String(error),
    })

    // Użytkownik dostaje kod, nigdy treści wyjątku ani ścieżki na dysku.
    return NextResponse.json({ errorCode: 'HEALTH_CHECK_FAILED' }, { status: 500 })
  }
}
