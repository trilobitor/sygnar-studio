import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import {
  ASSET_KINDS,
  JOB_KINDS,
  JOB_STATUSES,
  ORDER_INDUSTRIES,
  ORDER_STATUSES,
} from '@/lib/enums'

/**
 * Schemat bazy (SPEC §5). Tabele `snake_case` w liczbie mnogiej,
 * klucze obce `<tabela_pojedyncza>_id`, znaczniki czasu jako `INTEGER`
 * (milisekundy epoki), bo SQLite nie ma typu daty.
 */

/*
 * Listy wartości pochodzą ze schematów granicznych, a nie stoją tu drugi raz.
 * Wcześniej te same cztery statusy i pięć branż były wypisane w dwóch plikach;
 * dopisanie wartości w jednym z nich nie dawało żadnego sygnału o drugim.
 */
export const orderStatuses = ORDER_STATUSES
export const orderIndustries = ORDER_INDUSTRIES
export const jobKinds = JOB_KINDS
export const jobStatuses = JOB_STATUSES
export const assetKinds = ASSET_KINDS

/** Zlecenie — byt spinający całą pracę. */
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  industry: text('industry', { enum: orderIndustries }),
  status: text('status', { enum: orderStatuses }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Brief wypełniony przez grafika. Zapisywany przy każdym uruchomieniu. */
export const briefs = sqliteTable('briefs', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  /** Zgodny z `briefSchema`. Walidowany przy odczycie, nie tylko przy zapisie. */
  payloadJson: text('payload_json').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** Zadanie w kolejce. Stan trzymany w bazie, żeby restart nie gubił kolejki. */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: jobKinds }).notNull(),
    status: text('status', { enum: jobStatuses }).notNull(),
    paramsJson: text('params_json').notNull(),
    /** 0..1 */
    progress: real('progress').notNull().default(0),
    /** Etykieta dla interfejsu, po polsku. */
    phase: text('phase'),
    /** Kod z listy w SPEC §7a. Nigdy treść błędu wewnętrznego. */
    errorCode: text('error_code'),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    index('jobs_status_created_idx').on(table.status, table.createdAt),
    index('jobs_order_idx').on(table.orderId),
  ],
)

/** Każdy plik w systemie. `path` jest względny wobec `STUDIO_DATA_DIR`. */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: assetKinds }).notNull(),
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    /** Numer losowania. Bez niego nie da się powtórzyć kadru. */
    seed: integer('seed'),
    metadataJson: text('metadata_json'),
    starred: integer('starred').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('assets_order_kind_idx').on(table.orderId, table.kind)],
)

/** Rygor C: każde wywołanie modelu językowego jest zapisane razem z kosztem. */
export const promptRuns = sqliteTable('prompt_runs', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  briefJson: text('brief_json').notNull(),
  promptEn: text('prompt_en').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type Brief = typeof briefs.$inferSelect
export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
export type PromptRun = typeof promptRuns.$inferSelect

export const loginOutcomes = ['ok', 'zle-haslo', 'zablokowany', 'limit'] as const

/**
 * Osoby z dostępem do panelu.
 *
 * Panel przestał być jednoosobowy w chwili, gdy trafił poza tailnet: przy
 * jednym wspólnym haśle nie da się ani odebrać dostępu jednej osobie, ani
 * powiedzieć, kto co uruchomił. Hasła nie ma tu w żadnej postaci — wyłącznie
 * skrót scrypt, tak jak dotąd w `.env`.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Imię pokazywane w panelu i w logu wejść. */
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  /** Odebranie dostępu bez kasowania historii wejść. */
  disabledAt: integer('disabled_at'),
  /**
   * Sesje wydane **przed** tym znacznikiem przestają być ważne.
   *
   * Bez tego jedynym sposobem na wylogowanie kogoś ze wszystkich urządzeń
   * było odebranie mu dostępu w całości. Ciasteczko z ważnym podpisem
   * działało do końca swojego terminu, choćby hasło zostało zmienione.
   */
  sessionsValidFrom: integer('sessions_valid_from'),
})

/**
 * Log wejść — każda próba logowania, udana i nie.
 *
 * Przy panelu wystawionym publicznie to jedyny sposób, żeby zauważyć, że ktoś
 * dobija się do hasła. Zapisujemy skrót adresu, nie sam adres: do rozpoznania
 * „to znowu ten sam" wystarczy, a nie robi z logu spisu adresów IP.
 */
export const loginEvents = sqliteTable(
  'login_events',
  {
    id: text('id').primaryKey(),
    /** Puste przy nieudanej próbie — nie wiadomo, kto próbował. */
    userId: text('user_id'),
    outcome: text('outcome', { enum: loginOutcomes }).notNull(),
    clientHash: text('client_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('login_events_created_at').on(table.createdAt)],
)
