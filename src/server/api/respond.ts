import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

import { logger } from '@/lib/logger'
import { ApiError, JobError } from '@/server/adapters/types'

/**
 * Wspólna obsługa odpowiedzi błędnych.
 *
 * Użytkownik dostaje kod z zamkniętej listy, nigdy treści wyjątku, ścieżki
 * na dysku ani stack trace'a (SPEC §13). Szczegóły zostają w logu.
 */

export function fail(code: string, status: number): NextResponse {
  return NextResponse.json({ errorCode: code }, { status })
}

/** Zamienia dowolny wyjątek na odpowiedź z kodem. Nic nie połyka po cichu. */
export function handleError(error: unknown, where: string): NextResponse {
  if (error instanceof ZodError) {
    logger.warn('żądanie nie przeszło walidacji', {
      where,
      issues: error.issues.map((issue) => issue.path.join('.')).join(','),
    })
    return fail('VALIDATION_FAILED', 400)
  }

  if (error instanceof ApiError) {
    logger.warn('błąd warstwy API', { where, code: error.code, cause: error.message })
    return fail(error.code, error.status)
  }

  if (error instanceof JobError) {
    logger.warn('błąd zadania', { where, code: error.code, cause: error.message })
    return fail(error.code, 400)
  }

  logger.error('nieobsłużony błąd w route handlerze', {
    where,
    cause: error instanceof Error ? error.message : String(error),
  })

  return fail('VALIDATION_FAILED', 500)
}
