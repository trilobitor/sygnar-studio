import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * Migracje przy starcie serwera.
 *
 * Bez tego stan schematu zależał od tego, czy ktoś pamiętał o `npm run
 * db:migrate` — instalacja według `wdrozenie/README.md` dawała działający
 * proces i panel zwracający 500 na każdym żądaniu dotykającym danych.
 *
 * Ten moduł ładuje się wyłącznie w runtime Node (patrz `instrumentation.ts`).
 */
try {
  const database = new Database(join(env.STUDIO_DATA_DIR, 'studio.db'))
  database.exec('PRAGMA foreign_keys = ON')
  migrate(drizzle(database), {
    migrationsFolder: join(dirname(new URL(import.meta.url).pathname), 'server/db/migrations'),
  })
  database.close()
  logger.info('schemat bazy aktualny')
} catch (error) {
  // Błąd migracji jest zgłaszany, nie połykany — ale nie wywracamy startu,
  // żeby `/api/health` podniósł się i pokazał, że coś jest nie tak.
  logger.error('nie udało się zastosować migracji', {
    cause: error instanceof Error ? error.message : String(error),
  })
}
