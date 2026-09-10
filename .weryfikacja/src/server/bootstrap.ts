import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { startWorker } from '@/server/queue/worker'

/**
 * Próba zapisu w katalogu danych, raz przy starcie.
 *
 * `/api/health` sprawdza to samo, ale dopiero gdy ktoś zapyta. Ten wpis leci
 * do logu przy uruchomieniu, więc problem widać w `sygnar-studio.log` bez
 * otwierania panelu — a właśnie wtedy, gdy panel nie działa, nikt do niego nie
 * zajrzy.
 */
function sprawdzKatalogDanych(): void {
  const probka = join(env.STUDIO_DATA_DIR, '.probka-startu')

  try {
    writeFileSync(probka, 'x')
    unlinkSync(probka)
  } catch (error) {
    logger.error('brak prawa zapisu do katalogu danych', {
      katalog: env.STUDIO_DATA_DIR,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Rejestracja funkcji wykonawczych i uruchomienie kolejki.
 *
 * Importy poniżej wyglądają na nieużywane, ale każdy z tych modułów rejestruje
 * swój `JobRunner` przy załadowaniu. Bez nich worker wziąłby zadanie z kolejki
 * i nie miałby czym go wykonać.
 */
import '@/server/services/generation'
import '@/server/services/edit'
import '@/server/services/export'
import '@/server/services/video'
import '@/server/services/photo-batch'

let started = false

/** Wywoływane przez route handlery — pierwszy request stawia kolejkę na nogi. */
export function ensureStarted(): void {
  if (started) return
  started = true

  sprawdzKatalogDanych()
  startWorker()
}
