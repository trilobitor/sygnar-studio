import { randomUUID } from 'node:crypto'
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
  // Przeniesienie hasła z `.env` do tabeli osób.
  //
  // Panel miał jedno wspólne hasło w `STUDIO_PASSWORD_HASH`. Po wpuszczeniu
  // drugiej osoby hasła muszą być osobne, żeby dało się je odbierać pojedynczo
  // i żeby log wejść wskazywał, kto to był. Przenosimy zastane hasło raz, przy
  // pierwszym starcie po zmianie — nikt nie wpisuje niczego od nowa.
  if (env.STUDIO_PASSWORD_HASH.length > 0) {
    const ilu = database.prepare('SELECT COUNT(*) AS ile FROM users').get() as { ile: number }

    if (ilu.ile === 0) {
      database
        .prepare(
          'INSERT INTO users (id, name, password_hash, created_at, disabled_at) VALUES (?, ?, ?, ?, NULL)',
        )
        .run(randomUUID(), env.STUDIO_OWNER_NAME, env.STUDIO_PASSWORD_HASH, Date.now())

      logger.info('hasło z pliku przeniesione do tabeli osób', { kto: env.STUDIO_OWNER_NAME })
    }
  }

  database.close()
  logger.info('schemat bazy aktualny')
} catch (error) {
  // Błąd migracji jest zgłaszany, nie połykany — ale nie wywracamy startu,
  // żeby `/api/health` podniósł się i pokazał, że coś jest nie tak.
  logger.error('nie udało się zastosować migracji', {
    cause: error instanceof Error ? error.message : String(error),
  })
}
