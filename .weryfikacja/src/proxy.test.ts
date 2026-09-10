import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/server/db/client'
import { users } from '@/server/db/schema'
import { addUser, disableUser } from '@/server/services/users'
import { createSession, SESSION_COOKIE } from '@/server/services/session'

/**
 * Testy bramki (#18, #47). Bramka nie miała ani jednego, mimo że znaleziono
 * w niej dwa błędy dopiero na maszynie: `proxy.ts` w złym katalogu i matcher
 * przechwytujący websocket hot-reloadu.
 */
const SEKRET = 'a'.repeat(64)

vi.mock('@/lib/env', async (oryginal) => {
  const modul = await oryginal<typeof import('@/lib/env')>()
  return {
    ...modul,
    requiresLogin: true,
    env: { ...modul.env, STUDIO_SESSION_SECRET: 'a'.repeat(64) },
  }
})

const { proxy } = await import('./proxy')
const { NextRequest } = await import('next/server')

function zadanie(sciezka: string, ciasteczko?: string): Parameters<typeof proxy>[0] {
  const naglowki: Record<string, string> = {}
  if (ciasteczko !== undefined) naglowki.cookie = `${SESSION_COOKIE}=${ciasteczko}`

  // `NextRequest` wywodzi się z `Request`; bramka używa `cookies` i `nextUrl`,
  // które `NextRequest` dokłada nad zwykłym żądaniem.
  return new NextRequest(new Request(`http://localhost${sciezka}`, { headers: naglowki }))
}

beforeEach(() => {
  db.delete(users).run()
})

describe('bramka logowania', () => {
  it('przepuszcza ekran logowania bez sesji', () => {
    expect(proxy(zadanie('/logowanie')).status).toBe(200)
  })

  it('przepuszcza endpoint życia, bo nie zdradza niczego', () => {
    expect(proxy(zadanie('/api/zyje')).status).toBe(200)
  })

  it('przekierowuje stronę bez sesji na logowanie', () => {
    const odpowiedz = proxy(zadanie('/zlecenia/abc'))

    expect(odpowiedz.status).toBe(307)
    expect(odpowiedz.headers.get('location')).toContain('/logowanie')
  })

  it('trasom API odpowiada kodem, nie przekierowaniem', () => {
    // Przeglądarka nie ma renderować ekranu logowania w miejscu odpowiedzi JSON.
    const odpowiedz = proxy(zadanie('/api/orders'))

    expect(odpowiedz.status).toBe(401)
  })

  it('wpuszcza z ważną sesją', async () => {
    const user = await addUser('Kamil', 'dostatecznie-dlugie-haslo')

    expect(proxy(zadanie('/', createSession(user.id, SEKRET))).status).toBe(200)
  })

  it('odmawia po odebraniu dostępu, mimo ważnego podpisu', async () => {
    // Sesji nie ma w bazie, więc jedyne, co ją unieważnia, to pytanie o osobę.
    const user = await addUser('Oliwia', 'dostatecznie-dlugie-haslo')
    const token = createSession(user.id, SEKRET)

    expect(proxy(zadanie('/', token)).status).toBe(200)

    disableUser('Oliwia')
    expect(proxy(zadanie('/', token)).status).toBe(307)
  })

  it('odmawia przy podpisie z innego sekretu', async () => {
    const user = await addUser('Kamil', 'dostatecznie-dlugie-haslo')
    const obcy = createSession(user.id, 'b'.repeat(64))

    expect(proxy(zadanie('/', obcy)).status).toBe(307)
  })
})
