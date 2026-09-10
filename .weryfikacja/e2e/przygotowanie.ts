import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Świeży katalog danych na każdy przebieg E2E.
 *
 * Kasujemy go na starcie, nie na końcu: po nieudanym przebiegu chce się
 * zajrzeć, co zostało w bazie, a przed następnym i tak zaczynamy od zera.
 */
export default function przygotowanie(): void {
  const dane = join(process.cwd(), '.e2e-dane')

  rmSync(dane, { recursive: true, force: true })
  mkdirSync(dane, { recursive: true })

  const baza = new Database(join(dane, 'studio.db'))
  baza.exec('PRAGMA journal_mode = WAL')
  baza.exec('PRAGMA foreign_keys = ON')
  migrate(drizzle(baza), { migrationsFolder: 'src/server/db/migrations' })
  baza.close()
}
