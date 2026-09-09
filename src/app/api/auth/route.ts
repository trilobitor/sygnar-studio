import { NextResponse } from 'next/server'
import { z } from 'zod'

import { env, requiresLogin } from '@/lib/env'
import { logger } from '@/lib/logger'
import { fail, handleError } from '@/server/api/respond'
import {
  clientKey,
  consume,
  consumeGlobalLogin,
  LOGIN_LIMIT,
  reset,
} from '@/server/services/rate-limit'
import { alertUdaneLogowanie, alertZgadywanieHasla } from '@/server/services/alerty'
import { clientHash, findUserByPassword, recordLogin } from '@/server/services/users'
import {
  cookieOptions,
  createSession,
  polaczenieSzyfrowane,
  SESSION_COOKIE,
} from '@/server/services/session'

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
    const skrot = clientHash(key, env.STUDIO_SESSION_SECRET)
    const przegladarka = request.headers.get('user-agent')

    // Dwa liczniki: jeden na adres, drugi na cały panel. Sam licznik per adres
    // nie broni przed rozproszonym zgadywaniem, a globalny sam w sobie dałby
    // się wykorzystać do zablokowania logowania wszystkim.
    const decision = consume(key, LOGIN_LIMIT)
    const globalnie = consumeGlobalLogin()

    if (!decision.allowed || !globalnie.allowed) {
      const retryAfter = Math.max(decision.retryAfterSeconds, globalnie.retryAfterSeconds)
      logger.warn('przekroczono limit prób logowania', { retryAfter, skrot })
      recordLogin({ userId: null, outcome: 'limit', clientHash: skrot, userAgent: przegladarka })
      alertZgadywanieHasla(skrot)

      return NextResponse.json(
        { errorCode: 'TOO_MANY_ATTEMPTS' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    const body: unknown = await request.json()
    const input = loginSchema.parse(body)

    const user = await findUserByPassword(input.password)

    if (user === null) {
      logger.warn('nieudana próba logowania', { remaining: decision.remaining, skrot })
      recordLogin({
        userId: null,
        outcome: 'zle-haslo',
        clientHash: skrot,
        userAgent: przegladarka,
      })
      // Odpowiedź nie zdradza, czy hasło było bliskie ani czyje było —
      // jeden komunikat na wszystkie przypadki.
      return fail('BAD_PASSWORD', 401)
    }

    reset(key)
    logger.info('zalogowano do panelu', { kto: user.name })
    // Pytamy o znajomość miejsca **przed** zapisem, bo zapis sam czyni je znanym.
    alertUdaneLogowanie(user.name, skrot)
    recordLogin({ userId: user.id, outcome: 'ok', clientHash: skrot, userAgent: przegladarka })

    const response = NextResponse.json({ ok: true, kto: user.name })
    response.cookies.set(
      SESSION_COOKIE,
      createSession(user.id, env.STUDIO_SESSION_SECRET),
      // `secure` tylko po HTTPS — na localhost ciasteczko z tą flagą
      // nie zostałoby w ogóle zapisane.
      cookieOptions(polaczenieSzyfrowane(request)),
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
    ...cookieOptions(polaczenieSzyfrowane(request)),
    maxAge: 0,
  })
  logger.info('wylogowano z panelu')
  return response
}
