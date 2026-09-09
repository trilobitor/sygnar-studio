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
}

const database = globalForDb.studioDatabase ?? openDatabase()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.studioDatabase = database
}

export const db = drizzle(database, { schema })
export { schema }
