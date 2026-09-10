import { cookies } from 'next/headers'

import { env } from '@/lib/env'
import { readSession, SESSION_COOKIE } from './session'
import { getUser } from './users'

/**
 * Kto ogląda tę stronę.
 *
 * Do użytku w komponentach serwerowych. Zwraca imię albo `null`, gdy panel
 * chodzi bez logowania — wtedy nie ma czego pokazywać.
 */
export async function ktoZalogowany(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const sesja = readSession(token, env.STUDIO_SESSION_SECRET)

  if (sesja === null) return null

  return getUser(sesja.userId, sesja.wydanaO)?.name ?? null
}
