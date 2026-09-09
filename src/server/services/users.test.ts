import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/server/db/client'
import { loginEvents, users } from '@/server/db/schema'
import {
  addUser,
  clientHash,
  disableUser,
  findUserByPassword,
  getUser,
  invalidateSessions,
  listUsers,
  recentLogins,
  recordLogin,
} from './users'

const HASLO_A = 'jedno-bardzo-dlugie-haslo'
const HASLO_B = 'drugie-zupelnie-inne-haslo'

beforeEach(() => {
  db.delete(loginEvents).run()
  db.delete(users).run()
})

describe('osoby z dostępem', () => {
  it('rozpoznaje osobę po samym haśle', async () => {
    await addUser('Kamil', HASLO_A)
    await addUser('Oliwia', HASLO_B)

    expect((await findUserByPassword(HASLO_B))?.name).toBe('Oliwia')
    expect((await findUserByPassword(HASLO_A))?.name).toBe('Kamil')
  })

  it('nie wpuszcza na hasło, którego nikt nie ma', async () => {
    await addUser('Kamil', HASLO_A)

    expect(await findUserByPassword('cokolwiek-innego')).toBeNull()
  })

  it('po odebraniu dostępu hasło przestaje działać', async () => {
    await addUser('Oliwia', HASLO_B)
    expect(await findUserByPassword(HASLO_B)).not.toBeNull()

    expect(disableUser('Oliwia')).toBe(true)
    expect(await findUserByPassword(HASLO_B)).toBeNull()
  })

  it('odebranie dostępu unieważnia trwającą sesję', async () => {
    // Sesji nie ma w bazie, więc jedyne, co ją unieważnia, to `getUser`
    // odpowiadający `null`. Bez tego ciasteczko działałoby jeszcze tydzień.
    const user = await addUser('Oliwia', HASLO_B)
    expect(getUser(user.id)).not.toBeNull()

    disableUser('Oliwia')
    expect(getUser(user.id)).toBeNull()
  })

  it('odmawia dwóch osób z tym samym hasłem', async () => {
    // Inaczej log wejść wskazywałby nie tę osobę co trzeba, a to jedyny
    // powód, dla którego ten log istnieje.
    await addUser('Kamil', HASLO_A)

    await expect(addUser('Oliwia', HASLO_A)).rejects.toThrow(/Kamil/)
    expect(listUsers()).toHaveLength(1)
  })

  it('odebranie nieistniejącej osoby nie wywraca się', () => {
    expect(disableUser('Nikt')).toBe(false)
  })
})

describe('log wejść', () => {
  it('zapisuje udane i nieudane próby', async () => {
    const user = await addUser('Oliwia', HASLO_B)

    recordLogin({ userId: user.id, outcome: 'ok', clientHash: 'aaa', userAgent: 'test' })
    recordLogin({ userId: null, outcome: 'zle-haslo', clientHash: 'bbb', userAgent: null })

    const wpisy = recentLogins(10)

    expect(wpisy).toHaveLength(2)
    expect(wpisy.map((w) => w.outcome)).toEqual(expect.arrayContaining(['ok', 'zle-haslo']))
    expect(wpisy.find((w) => w.outcome === 'ok')?.name).toBe('Oliwia')
    expect(wpisy.find((w) => w.outcome === 'zle-haslo')?.name).toBeNull()
  })

  it('obcina zbyt długi nagłówek przeglądarki', async () => {
    // Nagłówek jest od klienta, więc nikt nie ma rozdymać bazy kilobajtem.
    const user = await addUser('Oliwia', HASLO_B)
    recordLogin({
      userId: user.id,
      outcome: 'ok',
      clientHash: 'aaa',
      userAgent: 'x'.repeat(5000),
    })

    const zapisany = db.select().from(loginEvents).all()[0]
    expect(zapisany?.userAgent?.length).toBe(200)
  })
})

describe('skrót adresu klienta', () => {
  it('ten sam adres daje ten sam skrót', () => {
    expect(clientHash('logowanie:1.2.3.4', 'sekret')).toBe(clientHash('logowanie:1.2.3.4', 'sekret'))
  })

  it('różne adresy dają różne skróty', () => {
    expect(clientHash('logowanie:1.2.3.4', 'sekret')).not.toBe(
      clientHash('logowanie:5.6.7.8', 'sekret'),
    )
  })

  it('bez sekretu skrót adresu odwróciłby się w sekundy — sól musi wchodzić', () => {
    expect(clientHash('logowanie:1.2.3.4', 'sekret-a')).not.toBe(
      clientHash('logowanie:1.2.3.4', 'sekret-b'),
    )
  })

  it('nie zapisuje samego adresu', () => {
    expect(clientHash('logowanie:1.2.3.4', 'sekret')).not.toContain('1.2.3.4')
  })
})

describe('unieważnianie sesji', () => {
  it('sesja wydana przed unieważnieniem przestaje działać', async () => {
    // Do tej pory jedynym sposobem na wylogowanie kogoś z cudzego urządzenia
    // było odebranie mu dostępu w całości.
    const user = await addUser('Oliwia', HASLO_B)
    const wydanaO = Date.now() - 1000

    expect(getUser(user.id, wydanaO)).not.toBeNull()

    expect(invalidateSessions('Oliwia')).toBe(true)
    expect(getUser(user.id, wydanaO)).toBeNull()
  })

  it('sesja wydana po unieważnieniu działa dalej', async () => {
    const user = await addUser('Oliwia', HASLO_B)
    invalidateSessions('Oliwia')

    expect(getUser(user.id, Date.now() + 1000)).not.toBeNull()
  })

  it('osoba zachowuje dostęp — to nie to samo co odebranie', async () => {
    await addUser('Oliwia', HASLO_B)
    invalidateSessions('Oliwia')

    expect(await findUserByPassword(HASLO_B)).not.toBeNull()
  })

  it('unieważnienie nieznanej osoby nie wywraca się', () => {
    expect(invalidateSessions('Nikt')).toBe(false)
  })
})
