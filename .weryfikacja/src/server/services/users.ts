import { createHash, randomUUID } from 'node:crypto'

import { and, desc, eq, isNull } from 'drizzle-orm'

import { db } from '@/server/db/client'
import { loginEvents, users, type loginOutcomes } from '@/server/db/schema'
import { hashPassword, verifyPassword } from './password'

/**
 * Osoby z dostępem do panelu i log wejść.
 *
 * Logowanie pyta wyłącznie o hasło — grafik nie ma pamiętać jeszcze loginu.
 * Kto to jest, rozpoznajemy po tym, czyj skrót pasuje.
 */

export type Outcome = (typeof loginOutcomes)[number]

export interface User {
  id: string
  name: string
}

/**
 * Skrót adresu klienta zamiast samego adresu.
 *
 * Do zauważenia „ktoś dobija się po raz setny" wystarczy stała wartość, a log
 * nie staje się przy okazji spisem adresów IP osób, które tu zaglądały.
 * Sól z sekretu sesji — bez niej skrót adresu IPv4 odwraca się w sekundy,
 * bo przestrzeń ma cztery miliardy elementów.
 */
export function clientHash(klucz: string, sekret: string): string {
  return createHash('sha256').update(`${sekret}:${klucz}`).digest('hex').slice(0, 16)
}

export function listUsers(): (User & { disabled: boolean; createdAt: number })[] {
  return db
    .select()
    .from(users)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      disabled: row.disabledAt !== null,
      createdAt: row.createdAt,
    }))
}

export async function addUser(name: string, password: string): Promise<User> {
  const hash = await hashPassword(password)

  // To samo hasło u dwóch osób sprawiłoby, że log wejść wskazuje nie tę osobę
  // co trzeba — a to jedyny powód, dla którego ten log istnieje.
  for (const row of db.select().from(users).all()) {
    if (await verifyPassword(password, row.passwordHash)) {
      throw new Error(`hasło jest już używane przez: ${row.name}`)
    }
  }

  const user = { id: randomUUID(), name, passwordHash: hash, createdAt: Date.now(), disabledAt: null }
  db.insert(users).values(user).run()

  return { id: user.id, name: user.name }
}

export function disableUser(name: string): boolean {
  const row = db.select().from(users).where(eq(users.name, name)).get()
  if (row === undefined) return false

  db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, row.id)).run()
  return true
}

/**
 * Sprawdza hasło przeciwko wszystkim czynnym osobom.
 *
 * Świadomie **bez wcześniejszego wyjścia** po trafieniu: przerwanie pętli na
 * pierwszym dopasowaniu robi z czasu odpowiedzi wskazówkę, która pozycja na
 * liście pasuje. Przy scrypcie każde sprawdzenie kosztuje setki milisekund,
 * więc różnica byłaby dobrze widoczna z zewnątrz.
 */
export async function findUserByPassword(password: string): Promise<User | null> {
  const czynni = db.select().from(users).where(isNull(users.disabledAt)).all()

  let trafiony: User | null = null

  for (const row of czynni) {
    if (await verifyPassword(password, row.passwordHash)) {
      trafiony = { id: row.id, name: row.name }
    }
  }

  return trafiony
}

/**
 * Osoba, jeśli nadal ma dostęp **i** jeśli sesja nie została unieważniona.
 *
 * `wydanaO` przychodzi z ciasteczka. Sesje wydane przed `sessionsValidFrom`
 * odpadają, choćby podpis był poprawny i termin jeszcze nie minął — to jedyny
 * sposób, żeby wylogować kogoś ze wszystkich urządzeń bez odbierania dostępu.
 */
export function getUser(id: string, wydanaO?: number): User | null {
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.disabledAt)))
    .get()

  if (row === undefined) return null

  if (
    wydanaO !== undefined &&
    row.sessionsValidFrom !== null &&
    wydanaO < row.sessionsValidFrom
  ) {
    return null
  }

  return { id: row.id, name: row.name }
}

/** Unieważnia wszystkie sesje osoby. Zwraca `true`, gdy taka osoba istnieje. */
export function invalidateSessions(name: string): boolean {
  const wynik = db
    .update(users)
    .set({ sessionsValidFrom: Date.now() })
    .where(eq(users.name, name))
    .run()

  return wynik.changes > 0
}

export function recordLogin(input: {
  userId: string | null
  outcome: Outcome
  clientHash: string
  userAgent: string | null
}): void {
  db.insert(loginEvents)
    .values({
      id: randomUUID(),
      userId: input.userId,
      outcome: input.outcome,
      clientHash: input.clientHash,
      // Nagłówek od klienta, więc obcinamy — nikt nie będzie tu wklejał
      // kilobajta, żeby rozdąć bazę.
      userAgent: input.userAgent === null ? null : input.userAgent.slice(0, 200),
      createdAt: Date.now(),
    })
    .run()
}

export function recentLogins(limit = 50): {
  name: string | null
  outcome: Outcome
  clientHash: string
  createdAt: number
}[] {
  const nazwy = new Map(db.select().from(users).all().map((u) => [u.id, u.name]))

  return db
    .select()
    .from(loginEvents)
    .orderBy(desc(loginEvents.createdAt))
    .limit(limit)
    .all()
    .map((row) => ({
      name: row.userId === null ? null : (nazwy.get(row.userId) ?? null),
      outcome: row.outcome,
      clientHash: row.clientHash,
      createdAt: row.createdAt,
    }))
}
