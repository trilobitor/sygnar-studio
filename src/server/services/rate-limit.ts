import { env } from '@/lib/env'

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
 * a nie ochrona zasobów. Osiem prób na pół godziny wystarczy człowiekowi,
 * który się pomylił, i nie wystarczy nikomu, kto próbuje słownika.
 *
 * Limit został zacieśniony z 15/kwadrans, gdy panel wyszedł poza tailnet.
 * W sieci prywatnej adres był znany garstce osób; publicznie nazwa hosta jest
 * w logach przejrzystości certyfikatów, więc trafiają tu też skanery.
 */
export const LOGIN_LIMIT: Bucket = { capacity: 8, windowMs: 30 * 60_000 }

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

/**
 * Twardy sufit liczby kluczy i sprzątanie wpisów z pełnym kubełkiem.
 *
 * Mapa rosła bez końca: każdy nowy adres zostawiał wpis na zawsze. Przy
 * panelu wystawionym publicznie skanery dokładają ich tysiące dziennie,
 * a proces panelu chodzi tygodniami.
 *
 * Wpis z **pełnym** kubełkiem starszy niż jego okno nie niesie żadnej
 * informacji — odtworzenie go od zera daje ten sam wynik.
 */
const MAX_KLUCZY = 10_000

function sprzatnij(now: number): void {
  for (const [klucz, wpis] of entries) {
    if (now - wpis.updatedAt > 60 * 60_000) entries.delete(klucz)
  }

  // Gdyby sprzątanie po czasie nie wystarczyło — wyrzucamy najstarsze.
  if (entries.size <= MAX_KLUCZY) return

  const posortowane = [...entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  for (const [klucz] of posortowane.slice(0, entries.size - MAX_KLUCZY)) {
    entries.delete(klucz)
  }
}

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
  // Sprzątamy przy zapisie, nie w odliczaniu — jeden mechanizm mniej i żadnego
  // budzenia procesu, gdy nikt nie puka.
  if (entries.size > 64) sprzatnij(now)

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

/** Tylko do testów: ile kluczy trzyma licznik. */
export function liczbaKluczy(): number {
  return entries.size
}

/** Tylko do testów: czyste liczniki między przypadkami. */
export function resetAll(): void {
  entries.clear()
}

/**
 * Klucz licznika.
 *
 * `X-Forwarded-For` i `X-Real-IP` ustawia **klient**, więc same z siebie nie są
 * żadnym identyfikatorem — zmierzone: dwadzieścia prób logowania z rotowanym
 * nagłówkiem przechodziło w komplecie, bo każda dostawała świeży kubełek.
 *
 * Wyjątkiem jest ruch z `tailscale funnel`. Tailscale **nadpisuje** ten nagłówek
 * prawdziwym adresem klienta i sam oznacza żądanie `Tailscale-Funnel-Request:
 * ?1` — sprawdzone próbą podszycia się: nagłówek podany przez klienta nie
 * przeszedł, do aplikacji dotarł adres rzeczywisty.
 *
 * Bez tego wyjątku limit per adres degenerował się do globalnego, bo przez
 * proxy wszystko przychodzi z pętli zwrotnej i każdy dostawał ten sam kubełek.
 * Zmierzone przed poprawką: żądania z zewnątrz miały ten sam skrót adresu co
 * wywołania z localhosta. Skutkiem było to, że jedna osoba zgadująca hasło
 * zamykała logowanie wszystkim pozostałym.
 */
export function clientKey(request: Request, prefix: string, socketAddress?: string): string {
  // `?1` to wartość nagłówka strukturalnego. Tailscale ustawia ją sam,
  // nadpisując cokolwiek przysłał klient.
  if (request.headers.get('tailscale-funnel-request') === '?1') {
    const odFunnela = request.headers.get('x-forwarded-for')?.trim()
    if (odFunnela !== undefined && odFunnela.length > 0) {
      return `${prefix}:${odFunnela}`
    }
  }

  const zaufane = env.TRUSTED_PROXY_IPS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const gniazdo = socketAddress ?? 'lokalny'

  if (zaufane.includes(gniazdo)) {
    const forwarded = request.headers.get('x-forwarded-for')
    const podany = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')
    if (podany !== undefined && podany !== null && podany.length > 0) {
      return `${prefix}:${podany}`
    }
  }

  return `${prefix}:${gniazdo}`
}

/**
 * Drugi, globalny kubełek na cały proces — niezależny od jakiegokolwiek
 * identyfikatora klienta. Nawet gdyby ktoś znalazł sposób na rozbicie
 * licznika per klient, ten sufit zostaje.
 */
export const GLOBAL_LOGIN_LIMIT: Bucket = { capacity: 30, windowMs: 60 * 60_000 }

export function consumeGlobalLogin(now = Date.now()): Decision {
  return consume('logowanie:globalnie', GLOBAL_LOGIN_LIMIT, now)
}
