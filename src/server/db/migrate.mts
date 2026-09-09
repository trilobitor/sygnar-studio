import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Uruchamia migracje na bazie wskazanej przez `STUDIO_DATA_DIR`.
 * Świadomie nie importuje `@/lib/env` — ma dać się odpalić z `node` bez
 * budowania aplikacji, więc czyta zmienną wprost i sam ją sprawdza.
 */

const dataDir = process.env.STUDIO_DATA_DIR

if (dataDir === undefined || dataDir.length === 0) {
  process.stderr.write('Brak zmiennej STUDIO_DATA_DIR — migracje nie mają gdzie działać.\n')
  process.exit(1)
}

mkdirSync(dataDir, { recursive: true })

const database = new Database(join(dataDir, 'studio.db'))
database.exec('PRAGMA foreign_keys = ON')

migrate(drizzle(database), { migrationsFolder: 'src/server/db/migrations' })

process.stdout.write('Migracje zastosowane.\n')
database.close()
