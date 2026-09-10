import type { Job } from '@/server/db/schema'

/**
 * Rozgłaszanie stanu kolejki do klientów (SPEC §8).
 *
 * Postęp idzie przez SSE, nie przez odpytywanie — jedno połączenie na klienta,
 * stan całej kolejki. Odpytywanie co sekundę przy zadaniach trwających minuty
 * to marnowanie zasobów po obu stronach.
 */

export interface QueueSnapshot {
  jobs: Job[]
  at: number
}

type Listener = (snapshot: QueueSnapshot) => void

/**
 * Next.js w trybie deweloperskim przeładowuje moduły, więc zbiór słuchaczy
 * musi przetrwać przeładunek — inaczej otwarte połączenia SSE osierocieją.
 */
const globalForEvents = globalThis as unknown as {
  queueListeners?: Set<Listener>
}

const listeners: Set<Listener> = globalForEvents.queueListeners ?? new Set<Listener>()
globalForEvents.queueListeners = listeners

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publish(snapshot: QueueSnapshot): void {
  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch {
      // Zerwane połączenie jednego klienta nie może zatrzymać rozgłaszania
      // do pozostałych ani wywrócić workera.
      listeners.delete(listener)
    }
  }
}

export function listenerCount(): number {
  return listeners.size
}
