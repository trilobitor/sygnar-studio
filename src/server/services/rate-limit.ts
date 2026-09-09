/**
 * Ograniczanie liczby żądań (SPEC §13).
 *
 * Endpoint uruchamiający minuty pracy GPU jest celem do wyczerpania zasobów —
 * to zdanie stoi wprost w specyfikacji i przestaje być teorią w dniu, w którym
 * panel wychodzi poza sieć prywatną.
 *
 * Kubełek żetonów: każdy klucz dostaje pulę, która odnawia się w czasie.
 * Stan trzymamy w pamięci procesu, bo panel jest jednoprocesowy i lokalny —
 * przy restarcie limity się zerują i to jest akceptowalne.
 */

export interface Bucket {
  /** Ile żądań mieści się w oknie. */
  capacity: number
  /** Długość okna w milisekundach. */
  windowMs: number
}

/** Uruchamianie zadań: minuty pracy GPU, więc pula jest wąska. */
export const JOB_LIMIT: Bucket = { capacity: 12, windowMs: 60_000 }

/** Wgrywanie plików: kosztuje dysk i pamięć, ale nie GPU. */
export const UPLOAD_LIMIT: Bucket = { capacity: 30, windowMs: 60_000 }

/** Warstwa promptowa: kosztuje limity subskrypcji. */
export const PROMPT_LIMIT: Bucket = { capacity: 20, windowMs: 60_000 }

/**
 * Logowanie. Pula wąska i okno długie — to jest zapora na zgadywanie hasła,
 * a nie ochrona zasobów. Piętnaście prób na kwadrans wystarczy człowiekowi,
 * który się pomylił, i nie wystarczy nikomu, kto próbuje słownika.
 */
export const LOGIN_LIMIT: Bucket = { capacity: 15, windowMs: 15 * 60_000 }

interface Entry {
  tokens: number
  updatedAt: number
}

/**
 * Next w trybie deweloperskim przeładowuje moduły, więc licznik musi
 * przetrwać przeładunek — inaczej limit zerowałby się przy każdej zmianie.
 */
const globalForLimiter = globalThis as unknown as { studioRateLimiter?: Map<string, Entry> }
const entries: Map<string, Entry> = globalForLimiter.studioRateLimiter ?? new Map()
globalForLimiter.studioRateLimiter = entries

export interface Decision {
  allowed: boolean
  /** Ile żądań jeszcze zostało w oknie. */
  remaining: number
  /** Za ile sekund można spróbować ponownie. Zero, gdy limit nie wyczerpany. */
  retryAfterSeconds: number
}

/**
 * Pobiera jeden żeton z kubełka. Żetony odnawiają się liniowo, więc klient
 * nie musi czekać na koniec całego okna, żeby wykonać kolejne żądanie.
 */
export function consume(key: string, bucket: Bucket, now = Date.now()): Decision {
  const entry = entries.get(key)
  const refillPerMs = bucket.capacity / bucket.windowMs

  const tokens =
    entry === undefined
      ? bucket.capacity
      : Math.min(bucket.capacity, entry.tokens + (now - entry.updatedAt) * refillPerMs)

  if (tokens < 1) {
    entries.set(key, { tokens, updatedAt: now })
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
    }
  }

  entries.set(key, { tokens: tokens - 1, updatedAt: now })
  return { allowed: true, remaining: Math.floor(tokens - 1), retryAfterSeconds: 0 }
}

/** Kasuje licznik — po udanym logowaniu nie ma po co karać za pomyłki. */
export function reset(key: string): void {
  entries.delete(key)
}

/** Tylko do testów: czyste liczniki między przypadkami. */
export function resetAll(): void {
  entries.clear()
}

/**
 * Klucz licznika. Za Tailscale i za tunelem adres klienta przychodzi
 * w nagłówku proxy, więc bierzemy go stamtąd, a gniazdo jest zapasem.
 */
export function clientKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const address = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'lokalny'
  return `${prefix}:${address}`
}
