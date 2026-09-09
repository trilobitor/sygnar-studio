import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { env, requiresLogin } from '@/lib/env'
import { readSession, SESSION_COOKIE } from '@/server/services/session'
import { getUser } from '@/server/services/users'

/**
 * Bramka logowania przed całą aplikacją (SPEC §13).
 *
 * W Next 16 `middleware.ts` jest przestarzałe i nazywa się `proxy.ts`.
 * Proxy działa w runtime Node, więc weryfikacja podpisu sesji może korzystać
 * z `node:crypto` — bez dokładania biblioteki do kryptografii webowej.
 *
 * To jest pierwsza warstwa, nie jedyna: `/api/uploads` sprawdza sesję u siebie
 * (`server/api/sesja.ts`), bo musiało wypaść spod proxy — Next buforuje ciało
 * żądania dla warstwy pośredniczącej i **ucina je na 10 MB**, przez co wgranie
 * filmu 19 MB kończyło się błędem walidacji, a filmu 3 MB przechodziło.
 */

/**
 * Ścieżki dostępne bez zalogowania.
 *
 * `/api/zyje` odpowiada wyłącznie `{ok:true}` — tyle, ile i tak widać po tym,
 * że serwer odpisał. `/api/health` **nie** jest publiczny, bo zdradza wersje
 * narzędzi i wolne miejsce na dysku.
 */
const PUBLIC_PATHS = ['/logowanie', '/api/auth', '/api/zyje']

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
  const sesja = readSession(token, env.STUDIO_SESSION_SECRET)

  // Nie wystarczy poprawny podpis: pytamy jeszcze bazę, czy ta osoba nadal ma
  // dostęp. Bez tego odebranie dostępu zadziałałoby dopiero po wygaśnięciu
  // ciasteczka, czyli nawet tydzień później.
  //
  // Zapytanie owijamy, bo uszkodzony plik bazy rzucał tutaj wyjątkiem i całe
  // żądanie kończyło się gołym „Internal Server Error" — bez kodu błędu, bez
  // komunikatu, bez wskazówki, co jest nie tak.
  try {
    if (sesja !== null && getUser(sesja.userId) !== null) {
      return NextResponse.next()
    }
  } catch {
    return NextResponse.json({ errorCode: 'DATABASE_UNAVAILABLE' }, { status: 503 })
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
   * `api/uploads` wypada spod proxy z powodu limitu 10 MB na ciało żądania —
   * sesji pilnuje tam sam handler.
   * Ikony i manifest też przepuszczamy: nie ma czego chronić w pliku PNG.
   * `sw.js` musi dać się pobrać z ekranu logowania — inaczej przeglądarka
   * nigdy nie uzna panelu za instalowalny.
   */
  matcher: ['/((?!api/uploads|_next/|ikona-|favicon.ico|manifest.webmanifest|sw.js).*)'],
}
