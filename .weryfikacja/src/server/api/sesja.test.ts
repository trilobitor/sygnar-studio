import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/server/db/client'
import { users } from '@/server/db/schema'
import { addUser, disableUser } from '@/server/services/users'
import { createSession, SESSION_COOKIE } from '@/server/services/session'

/**
 * `requiresLogin` jest w testach wyłączone (patrz `test-setup.ts`), więc
 * ładujemy moduł z podmienionym `env`. Inaczej `wymagajSesji` zawsze zwracałby
 * `null` i test nie sprawdzałby niczego.
 */
vi.mock('@/lib/env', async (oryginal) => {
  const modul = await oryginal<typeof import('@/lib/env')>()
  // Stała musi być tutaj — `vi.mock` jest wynoszone na górę pliku, więc
  // nie widzi zmiennych zadeklarowanych poniżej.
  return {
    ...modul,
    requiresLogin: true,
    env: { ...modul.env, STUDIO_SESSION_SECRET: 'a'.repeat(64) },
  }
})

const SEKRET = 'a'.repeat(64)

const { wymagajSesji } = await import('./sesja')

function zadanie(ciasteczko?: string): Request {
  return new Request('http://localhost/api/uploads', {
    method: 'POST',
    headers: ciasteczko === undefined ? {} : { cookie: `${SESSION_COOKIE}=${ciasteczko}` },
  })
}

beforeEach(() => {
  db.delete(users).run()
})

describe('wymagajSesji', () => {
  it('wpuszcza z ważnym ciasteczkiem i mówi, kto to', async () => {
    const user = await addUser('Oliwia', 'dostatecznie-dlugie-haslo')

    expect(wymagajSesji(zadanie(createSession(user.id, SEKRET)))?.name).toBe('Oliwia')
  })

  it('odmawia bez ciasteczka', () => {
    // Ta trasa jest wyłączona spod proxy, więc bez tego sprawdzenia wgrywanie
    // byłoby otwarte dla każdego.
    expect(() => wymagajSesji(zadanie())).toThrow(/sesji/)
  })

  it('odmawia przy podrobionym podpisie', async () => {
    const user = await addUser('Oliwia', 'dostatecznie-dlugie-haslo')
    const token = createSession(user.id, 'zupelnie-inny-sekret-o-dlugosci-64-znakow-aaaaaaaaaaaaaaaaaaaaaaa')

    expect(() => wymagajSesji(zadanie(token))).toThrow()
  })

  it('odmawia osobie, której odebrano dostęp', async () => {
    const user = await addUser('Oliwia', 'dostatecznie-dlugie-haslo')
    const token = createSession(user.id, SEKRET)

    expect(wymagajSesji(zadanie(token))).not.toBeNull()

    disableUser('Oliwia')
    expect(() => wymagajSesji(zadanie(token))).toThrow()
  })

  it('radzi sobie z innymi ciasteczkami obok sesyjnego', async () => {
    const user = await addUser('Oliwia', 'dostatecznie-dlugie-haslo')
    const token = createSession(user.id, SEKRET)
    const request = new Request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { cookie: `inne=wartosc; ${SESSION_COOKIE}=${token}; jeszcze=cos` },
    })

    expect(wymagajSesji(request)?.name).toBe('Oliwia')
  })
})
