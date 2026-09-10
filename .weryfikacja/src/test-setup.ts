import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Konfiguracja dla testów. Katalog danych jest tymczasowy i osobny dla
 * każdego uruchomienia, więc testy nie dotykają prawdziwych zleceń.
 * Schemat zakładamy tą samą migracją, która idzie na produkcję.
 */

const dataDir = mkdtempSync(join(tmpdir(), 'sygnar-test-'))

process.env.STUDIO_DATA_DIR = dataDir
process.env.MFLUX_BIN_DIR = process.env.MFLUX_BIN_DIR ?? '/nieistniejacy/bin'
process.env.FFMPEG_PATH = process.env.FFMPEG_PATH ?? '/nieistniejacy/ffmpeg'
process.env.DARKTABLE_CLI_PATH = ''
process.env.ANTHROPIC_API_KEY = ''
process.env.MAX_CONCURRENT_GPU_JOBS = '1'
process.env.JOB_TIMEOUT_MS = '900000'
process.env.LOG_LEVEL = 'error'

// Testy nie mają hasła, więc bramkę wyłączamy **jawnie**. Od poprawki #4
// brak hasła zatrzymuje start zamiast po cichu otwierać panel, więc bez tej
// linii nie wystartowałby ani jeden plik testowy — i o to chodziło.
process.env.STUDIO_REQUIRE_LOGIN = '0'

const database = new Database(join(dataDir, 'studio.db'))
database.exec('PRAGMA foreign_keys = ON')
migrate(drizzle(database), { migrationsFolder: 'src/server/db/migrations' })
database.close()
