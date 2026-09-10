import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

import pkg from '@next/env'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Uruchamia migracje na bazie wskazanej przez `STUDIO_DATA_DIR`.
 *
 * Konfigurację czytamy loaderem Next.js, a nie gołym `process.env` — `node`
 * nie wczytuje `.env` sam z siebie i komenda zawodziła mimo poprawnego pliku.
 * Katalog migracji liczymy od położenia tego pliku, żeby komenda działała
 * z dowolnego katalogu roboczego.
 */

pkg.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} })

const dataDir = process.env.STUDIO_DATA_DIR

if (dataDir === undefined || dataDir.length === 0) {
  process.stderr.write('Brak zmiennej STUDIO_DATA_DIR — migracje nie mają gdzie działać.\n')
  process.exit(1)
}

mkdirSync(dataDir, { recursive: true })

const database = new Database(join(dataDir, 'studio.db'))
database.exec('PRAGMA foreign_keys = ON')

migrate(drizzle(database), { migrationsFolder: join(dirname(new URL(import.meta.url).pathname), 'migrations') })

process.stdout.write('Migracje zastosowane.\n')
database.close()
