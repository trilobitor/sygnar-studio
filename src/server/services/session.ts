import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Sesja podpisana skrótem HMAC (SPEC §13).
 *
 * Nie trzymamy sesji w bazie: ciasteczko niesie termin ważności i losowy
 * identyfikator, a podpis pilnuje, żeby nikt nie podmienił terminu. Panel
 * jest jednoosobowy, więc lista aktywnych sesji nie ma tu czego wnosić.
 *
 * Format: `<termin ms>.<losowe hex>.<podpis hex>`
 */

export const SESSION_COOKIE = 'sygnar_sesja'

/** Ile trwa sesja. Tydzień — grafik nie ma logować się codziennie rano. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function createSession(userId: string, secret: string, now = Date.now()): string {
  const payload = `${now + SESSION_TTL_MS}.${userId}.${randomBytes(16).toString('hex')}`
  return `${payload}.${sign(payload, secret)}`
}

/**
 * Sprawdza podpis i termin ważności. Porównanie podpisów w czasie stałym —
 * inaczej dałoby się go odgadywać bajt po bajcie.
 */
export function readSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): { userId: string } | null {
  if (token === undefined || token.length === 0) return null

  const parts = token.split('.')
  if (parts.length !== 4) return null

  const [expiresAt, userId, nonce, signature] = parts
  if (
    expiresAt === undefined ||
    userId === undefined ||
    nonce === undefined ||
    signature === undefined
  ) {
    return null
  }

  const expected = sign(`${expiresAt}.${userId}.${nonce}`, secret)

  try {
    const a = Buffer.from(signature, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    // Podpis nie jest poprawnym hexem — traktujemy jak zły podpis.
    return null
  }

  const deadline = Number(expiresAt)
  if (!Number.isFinite(deadline) || deadline <= now) return null

  return { userId }
}

/** Sam fakt ważnej sesji, bez pytania kto. Używa tego bramka w `proxy.ts`. */
export function verifySession(token: string | undefined, secret: string, now = Date.now()): boolean {
  return readSession(token, secret, now) !== null
}

/**
 * Czy przeglądarka rozmawiała po HTTPS.
 *
 * Za `tailscale serve` Next widzi zwykłe HTTP z pętli zwrotnej, bo proxy
 * rozwiązuje TLS u siebie. Bez tego ciasteczko sesji nie dostawało flagi
 * `Secure` mimo szyfrowanego połączenia z przeglądarką.
 *
 * Nagłówkowi ufamy, bo panel nasłuchuje wyłącznie na 127.0.0.1 — z zewnątrz
 * nie da się do niego dojść inaczej niż przez proxy, które ten nagłówek
 * ustawia samo.
 */
export function polaczenieSzyfrowane(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true
  return request.headers.get('x-forwarded-proto') === 'https'
}

/** Atrybuty ciasteczka. `secure` tylko po HTTPS — na localhost go nie ma. */
export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
