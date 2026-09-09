import type { Brief } from '@/lib/schemas'
import type { AdapterHealth } from '@/server/services/health'
import type { Asset, Job, Order } from '@/server/db/schema'

/**
 * Kształty odpowiedzi API widziane przez klienta.
 * Typy pochodzą ze schematu bazy, nie są dublowane ręcznie.
 */

export type { Asset, Job, Order, AdapterHealth }

export interface HealthResponse {
  ready: boolean
  adapters: AdapterHealth[]
  checkedAt: number
}

export interface OrderDetail {
  order: Order
  assets: Asset[]
  jobs: Job[]
  /**
   * Ostatni brief zlecenia. Typ był `unknown` i nikt go nie odczytywał —
   * makieta zapisywała się do bazy, wracała w odpowiedzi API i tam kończyła
   * żywot. Grafik po ponownym otwarciu okna widział puste pola.
   */
  brief: Brief | null
}

export interface PromptResponse {
  promptEn: string
  assumptions: string[]
  /** Skąd wziął się opis: model językowy czy składacz deterministyczny. */
  source: 'cli' | 'api' | 'builder'
  /** Czy punkt pierwszy został przepuszczony bez tłumaczenia. */
  needsTranslation: boolean
  dimensions: { width: number; height: number }
  purpose: string
}

export interface ErrorResponse {
  errorCode: string
}
