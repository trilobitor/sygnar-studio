import { beforeEach, describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from './password'
import {
  clientKey,
  consume,
  consumeGlobalLogin,
  GLOBAL_LOGIN_LIMIT,
  LOGIN_LIMIT,
  reset,
  resetAll,
  type Bucket,
} from './rate-limit'
import { cookieOptions, createSession, SESSION_TTL_MS, verifySession } from './session'

/**
 * Dostęp do panelu jest jedyną warstwą autoryzacji po wystawieniu poza
 * sieć prywatną (SPEC §13), więc testy są tu tak samo obowiązkowe jak przy
 * budowaniu ścieżek.
 */

const SECRET = 'a'.repeat(64)

describe('hasło', () => {
  it('przepuszcza poprawne hasło', async () => {
    const stored = await hashPassword('poprawne-haslo-123')
    expect(await verifyPassword('poprawne-haslo-123', stored)).toBe(true)
  })

  it('odrzuca błędne hasło', async () => {
    const stored = await hashPassword('poprawne-haslo-123')
    expect(await verifyPassword('poprawne-haslo-124', stored)).toBe(false)
  })

  it('nie przechowuje hasła jawnym tekstem', async () => {
    const stored = await hashPassword('tajne-haslo-xyz')
    expect(stored).not.toContain('tajne-haslo-xyz')
    expect(stored.startsWith('scrypt:')).toBe(true)
  })

  it('daje inny skrót przy każdym wywołaniu — sól jest losowa', async () => {
    const a = await hashPassword('to-samo-haslo')
    const b = await hashPassword('to-samo-haslo')
    expect(a).not.toBe(b)
    // Mimo różnych skrótów oba muszą przepuszczać to samo hasło.
    expect(await verifyPassword('to-samo-haslo', a)).toBe(true)
    expect(await verifyPassword('to-samo-haslo', b)).toBe(true)
  })

  it.each(['', 'nonsens', 'scrypt:abc', 'bcrypt:1:aa:bb', 'scrypt$1$aa$bb'])(
    'odrzuca uszkodzony wpis %s zamiast się wywracać',
    async (stored) => {
      expect(await verifyPassword('cokolwiek', stored)).toBe(false)
    },
  )
})

describe('sesja', () => {
  it('przepuszcza własny, świeży token', () => {
    expect(verifySession(createSession(SECRET), SECRET)).toBe(true)
  })

  it('odrzuca token podpisany innym sekretem', () => {
    const token = createSession('b'.repeat(64))
    expect(verifySession(token, SECRET)).toBe(false)
  })

  it('odrzuca token z podmienionym terminem ważności', () => {
    const token = createSession(SECRET)
    const parts = token.split('.')
    // Przedłużamy ważność o rok, zostawiając oryginalny podpis.
    const sfałszowany = [String(Number(parts[0]) + 31_536_000_000), parts[1], parts[2]].join('.')
    expect(verifySession(sfałszowany, SECRET)).toBe(false)
  })

  it('odrzuca token po terminie', () => {
    const token = createSession(SECRET, 0)
    expect(verifySession(token, SECRET, SESSION_TTL_MS + 1)).toBe(false)
  })

  it.each([undefined, '', 'nonsens', 'a.b', 'a.b.c.d', 'a.b.zzzz'])(
    'odrzuca token o kształcie %s',
    (token) => {
      expect(verifySession(token, SECRET)).toBe(false)
    },
  )

  it('ciasteczko jest niedostępne dla skryptów', () => {
    const options = cookieOptions(true)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.secure).toBe(true)
  })

  it('bez HTTPS nie ustawiamy flagi secure — inaczej ciasteczko przepada', () => {
    expect(cookieOptions(false).secure).toBe(false)
  })
})

describe('limit żądań', () => {
  const bucket: Bucket = { capacity: 3, windowMs: 1000 }

  beforeEach(() => {
    resetAll()
  })

  it('przepuszcza do wyczerpania puli', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consume('test', bucket, 0).allowed).toBe(true)
    }
    expect(consume('test', bucket, 0).allowed).toBe(false)
  })

  it('mówi, za ile sekund spróbować ponownie', () => {
    for (let i = 0; i < 3; i += 1) consume('test', bucket, 0)
    expect(consume('test', bucket, 0).retryAfterSeconds).toBeGreaterThan(0)
  })

  it('odnawia żetony z upływem czasu', () => {
    for (let i = 0; i < 3; i += 1) consume('test', bucket, 0)
    expect(consume('test', bucket, 0).allowed).toBe(false)
    // Po pełnym oknie pula jest z powrotem pełna.
    expect(consume('test', bucket, 1000).allowed).toBe(true)
  })

  it('liczy osobno dla każdego klucza', () => {
    for (let i = 0; i < 3; i += 1) consume('pierwszy', bucket, 0)
    expect(consume('pierwszy', bucket, 0).allowed).toBe(false)
    expect(consume('drugi', bucket, 0).allowed).toBe(true)
  })

  it('kasuje licznik po udanym logowaniu', () => {
    for (let i = 0; i < 3; i += 1) consume('test', bucket, 0)
    reset('test')
    expect(consume('test', bucket, 0).allowed).toBe(true)
  })

  it('pula logowania wystarcza człowiekowi, nie wystarcza słownikowi', () => {
    // Piętnaście prób na kwadrans: pomyłka przejdzie, atak słownikowy nie.
    expect(LOGIN_LIMIT.capacity).toBeLessThanOrEqual(20)
    expect(LOGIN_LIMIT.windowMs).toBeGreaterThanOrEqual(10 * 60_000)
  })

  it('IGNORUJE nagłówek proxy od niezaufanego klienta', () => {
    // Zmierzone przed poprawką: dwadzieścia prób logowania z rotowanym
    // `X-Forwarded-For` przechodziło w komplecie, bo każda dostawała świeży
    // kubełek. Nagłówek ustawia klient, więc sam z siebie nie jest niczym.
    const a = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.1' } })
    const b = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.2' } })

    expect(clientKey(a, 'test')).toBe(clientKey(b, 'test'))
  })

  it('rotacja nagłówka nie daje nowej puli', () => {
    const bucket: Bucket = { capacity: 3, windowMs: 60_000 }

    for (let i = 0; i < 3; i += 1) {
      const req = new Request('http://x/', { headers: { 'x-forwarded-for': `9.9.9.${i}` } })
      expect(consume(clientKey(req, 'log'), bucket, 0).allowed).toBe(true)
    }

    // Czwarte żądanie z kolejnym, świeżym adresem musi się odbić.
    const czwarte = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.99' } })
    expect(consume(clientKey(czwarte, 'log'), bucket, 0).allowed).toBe(false)
  })

  it('globalny kubełek logowania istnieje jako drugi sufit', () => {
    expect(GLOBAL_LOGIN_LIMIT.capacity).toBeGreaterThan(0)
    expect(GLOBAL_LOGIN_LIMIT.windowMs).toBeGreaterThanOrEqual(60 * 60_000)
    expect(consumeGlobalLogin(0).allowed).toBe(true)
  })
})
