import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/better-sqlite3'

import { env } from '@/lib/env'
import * as schema from './schema'

/**
 * Połączenie z bazą (decyzja D2 — SQLite zamiast Postgresa).
 *
 * Sterownikiem jest `better-sqlite3` (decyzja D9). Node 26 ma wbudowany
 * `node:sqlite` i byłby lepszym wyborem, ale dialekt `drizzle-orm/node-sqlite`
 * istnieje dopiero w linii `1.0.0-rc`, a na release candidate stacji
 * produkcyjnej nie stawiamy. Warstwa zapytań zostaje ta sama, gdyby projekt
 * kiedyś przeszedł na Postgresa.
 */

export const DATABASE_FILE_NAME = 'studio.db'

function openDatabase(): Database.Database {
  mkdirSync(env.STUDIO_DATA_DIR, { recursive: true })
  const file = join(env.STUDIO_DATA_DIR, DATABASE_FILE_NAME)
  const database = new Database(file)

  // WAL pozwala czytać w trakcie zapisu — kolejka pisze, interfejs czyta.
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA foreign_keys = ON')

  return database
}

/**
 * Next.js w trybie deweloperskim przeładowuje moduły przy każdej zmianie,
 * więc bez tego cache'u powstawałoby nowe połączenie na każdy przeładunek.
 */
const globalForDb = globalThis as unknown as {
  studioDatabase?: Database.Database
  studioDb?: ReturnType<typeof drizzle>
}

/**
 * Połączenie otwieramy **przy pierwszym zapytaniu**, nie przy imporcie modułu.
 *
 * Uszkodzony plik bazy wywracał się w trakcie ładowania modułu, więc padała
 * każda trasa, która choćby pośrednio go dotykała — łącznie z `/api/health`,
 * czyli jedynym miejscem mogącym powiedzieć, co jest nie tak. Grafik dostawał
 * gołe „Internal Server Error" bez jednej wskazówki.
 *
 * Teraz `/api/health` odpowiada normalnie i pokazuje „Baza zleceń: błąd".
 */
function polaczenie(): Database.Database {
  const zastane = globalForDb.studioDatabase
  if (zastane !== undefined) return zastane

  const swieze = openDatabase()

  // Trzymamy je również na produkcji: pośrednik poniżej sięga tu przy każdym
  // zapytaniu, więc bez cache'u otwieralibyśmy plik za każdym razem.
  globalForDb.studioDatabase = swieze

  return swieze
}

function klient(): ReturnType<typeof drizzle> {
  const zastany = globalForDb.studioDb
  if (zastany !== undefined) return zastany

  const swiezy = drizzle(polaczenie(), { schema })
  globalForDb.studioDb = swiezy
  return swiezy
}

/**
 * `db` jest pośrednikiem, nie gotowym klientem: każde sięgnięcie po metodę
 * otwiera połączenie, jeśli jeszcze go nie ma. Dzięki temu sam import tego
 * modułu nigdy nie rzuca.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_cel, wlasciwosc) {
    const rzeczywisty = klient() as unknown as Record<string | symbol, unknown>
    const wartosc = rzeczywisty[wlasciwosc]
    return typeof wartosc === 'function' ? wartosc.bind(rzeczywisty) : wartosc
  },
})

export { schema }
