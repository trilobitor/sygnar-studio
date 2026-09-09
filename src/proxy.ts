import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { env, requiresLogin } from '@/lib/env'
import { SESSION_COOKIE, verifySession } from '@/server/services/session'

/**
 * Bramka logowania przed całą aplikacją (SPEC §13).
 *
 * W Next 16 `middleware.ts` jest przestarzałe i nazywa się `proxy.ts`.
 * Proxy działa w runtime Node, więc weryfikacja podpisu sesji może korzystać
 * z `node:crypto` — bez dokładania biblioteki do kryptografii webowej.
 *
 * To jest pierwsza warstwa, nie jedyna: route handlery uruchamiające zadania
 * sprawdzają sesję jeszcze raz u siebie. Bramka odsiewa ruch, ale prawdziwa
 * decyzja zapada tam, gdzie coś realnie się dzieje.
 */

/** Ścieżki dostępne bez zalogowania — sam ekran logowania i jego endpoint. */
const PUBLIC_PATHS = ['/logowanie', '/api/auth']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function proxy(request: NextRequest): NextResponse {
  // Bez skonfigurowanego hasła panel działa jak dotąd — na localhost sieć
  // jest jedyną warstwą dostępu i tak to jest opisane w specyfikacji.
  if (!requiresLogin) return NextResponse.next()

  const { pathname } = request.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (verifySession(token, env.STUDIO_SESSION_SECRET)) {
    return NextResponse.next()
  }

  // Żądania do API dostają kod, nie przekierowanie — przeglądarka nie ma
  // renderować ekranu logowania w miejscu odpowiedzi JSON.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ errorCode: 'NOT_AUTHENTICATED' }, { status: 401 })
  }

  const target = new URL('/logowanie', request.url)
  // Po zalogowaniu wracamy tam, gdzie użytkownik chciał wejść.
  if (pathname !== '/') target.searchParams.set('dalej', pathname)

  return NextResponse.redirect(target)
}

export const config = {
  /**
   * Pomijamy **całe** `_next`, nie tylko `static` i `image`.
   *
   * Pod `_next/hmr` siedzi WebSocket hot-reloadu. Bramka odpowiadała na jego
   * uścisk dłoni przekierowaniem, przez co strona w trybie deweloperskim
   * w ogóle się nie hydratowała — formularz logowania był martwy.
   * Ikony i manifest też przepuszczamy: nie ma czego chronić w pliku PNG.
   * `sw.js` musi dać się pobrać z ekranu logowania — inaczej przeglądarka
   * nigdy nie uzna panelu za instalowalny.
   */
  matcher: ['/((?!_next/|ikona-|favicon.ico|manifest.webmanifest|sw.js).*)'],
}
