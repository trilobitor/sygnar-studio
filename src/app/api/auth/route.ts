import { NextResponse } from 'next/server'
import { z } from 'zod'

import { env, requiresLogin } from '@/lib/env'
import { logger } from '@/lib/logger'
import { fail, handleError } from '@/server/api/respond'
import { verifyPassword } from '@/server/services/password'
import { clientKey, consume, LOGIN_LIMIT, reset } from '@/server/services/rate-limit'
import { cookieOptions, createSession, SESSION_COOKIE } from '@/server/services/session'

export const dynamic = 'force-dynamic'

const loginSchema = z.object({
  password: z.string().min(1).max(200),
})

/**
 * Logowanie do panelu (SPEC §13).
 *
 * Próby są limitowane per adres klienta — piętnaście na kwadrans. To jest
 * zapora na zgadywanie hasła, nie ochrona zasobów, więc okno jest długie.
 * Po udanym logowaniu licznik się kasuje.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!requiresLogin) {
      // Panel bez skonfigurowanego hasła nie ma czego weryfikować.
      return fail('VALIDATION_FAILED', 400)
    }

    const key = clientKey(request, 'logowanie')
    const decision = consume(key, LOGIN_LIMIT)

    if (!decision.allowed) {
      logger.warn('przekroczono limit prób logowania', { retryAfter: decision.retryAfterSeconds })
      return NextResponse.json(
        { errorCode: 'TOO_MANY_ATTEMPTS' },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      )
    }

    const body: unknown = await request.json()
    const input = loginSchema.parse(body)

    if (!(await verifyPassword(input.password, env.STUDIO_PASSWORD_HASH))) {
      logger.warn('nieudana próba logowania', { remaining: decision.remaining })
      // Odpowiedź nie zdradza, czy hasło było bliskie — jeden komunikat na
      // wszystkie przypadki.
      return fail('BAD_PASSWORD', 401)
    }

    reset(key)
    logger.info('zalogowano do panelu')

    const response = NextResponse.json({ ok: true })
    response.cookies.set(
      SESSION_COOKIE,
      createSession(env.STUDIO_SESSION_SECRET),
      // `secure` tylko po HTTPS — na localhost ciasteczko z tą flagą
      // nie zostałoby w ogóle zapisane.
      cookieOptions(new URL(request.url).protocol === 'https:'),
    )

    return response
  } catch (error) {
    return handleError(error, 'POST /api/auth')
  }
}

/** Wylogowanie — kasujemy ciasteczko sesji. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    ...cookieOptions(new URL(request.url).protocol === 'https:'),
    maxAge: 0,
  })
  logger.info('wylogowano z panelu')
  return response
}
