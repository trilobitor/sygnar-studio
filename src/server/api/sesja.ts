import { env, requiresLogin } from '@/lib/env'
import { ApiError } from '@/server/adapters/types'
import { readSession, SESSION_COOKIE } from '@/server/services/session'
import { getUser, type User } from '@/server/services/users'

/**
 * Sprawdzenie sesji wewnątrz trasy.
 *
 * Do tej pory jedyną bramką było `proxy.ts`, mimo że komentarz w nim
 * obiecywał, iż „route handlery sprawdzają sesję jeszcze raz u siebie" —
 * nie sprawdzały. Teraz to prawda dla tras, które coś kosztują: wgrywania
 * plików i uruchamiania zadań.
 *
 * Ma to drugi, bardziej przyziemny powód. `/api/uploads` musiało wypaść spod
 * proxy, bo Next buforuje ciało żądania dla warstwy pośredniczącej i **ucina
 * je na 10 MB** — wgranie filmu 19 MB kończyło się błędem walidacji, a filmu
 * 3 MB przechodziło. Bez sprawdzenia tutaj wgrywanie zostałoby bez ochrony.
 */
export function wymagajSesji(request: Request): User | null {
  if (!requiresLogin) return null

  const ciasteczko = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1)

  const sesja = readSession(ciasteczko, env.STUDIO_SESSION_SECRET)
  const user = sesja === null ? null : getUser(sesja.userId)

  if (user === null) {
    throw new ApiError('NOT_AUTHENTICATED', 'brak ważnej sesji', 401)
  }

  return user
}
