import { startWorker } from '@/server/queue/worker'

/**
 * Rejestracja funkcji wykonawczych i uruchomienie kolejki.
 *
 * Importy poniżej wyglądają na nieużywane, ale każdy z tych modułów rejestruje
 * swój `JobRunner` przy załadowaniu. Bez nich worker wziąłby zadanie z kolejki
 * i nie miałby czym go wykonać.
 */
import '@/server/services/generation'
import '@/server/services/export'
import '@/server/services/video'
import '@/server/services/photo-batch'

let started = false

/** Wywoływane przez route handlery — pierwszy request stawia kolejkę na nogi. */
export function ensureStarted(): void {
  if (started) return
  started = true
  startWorker()
}
