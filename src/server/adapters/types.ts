/**
 * Kontrakt wspólny dla wszystkich adapterów (SPEC §6, decyzja D3).
 *
 * Adapter nie wie nic o Next.js, bazie ani interfejsie. Dostaje parametry
 * i kontekst, oddaje wynik albo rzuca błędem z kodem z listy w SPEC §7a.
 */

/** Poziom logu — `logger` zastępuje `console.log`, którego w kodzie nie ma. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Kontekst logu: kto, co, jakie ID. Nigdy gołe zdanie bez identyfikatorów. */
export type LogContext = Record<string, string | number | boolean | null>

export interface Logger {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
  /** Logger potomny z doklejonym kontekstem — np. `{ jobId }` na całe zadanie. */
  child: (context: LogContext) => Logger
}

/**
 * Powód niedostępności adaptera. Lista zamknięta — nowy tryb awarii wymaga
 * nowej wartości tutaj i nowego komunikatu w mapowaniu dla interfejsu.
 */
export type HealthFailureReason = 'unreachable' | 'misconfigured' | 'missing_binary'

export type HealthStatus =
  | { ok: true; version?: string }
  | { ok: false; reason: HealthFailureReason }

export interface JobProgress {
  /** 0..1 */
  percent: number
  /** Etykieta pokazywana użytkownikowi, po polsku. Bez żargonu. */
  phase: string
}

export interface JobContext {
  signal: AbortSignal
  workDir: string
  onProgress: (progress: JobProgress) => void
  logger: Logger
}

export interface Adapter<TParams, TResult> {
  readonly name: string
  /** Sprawdzenie dostępności — wywoływane przez `/api/health`. */
  check: () => Promise<HealthStatus>
  run: (params: TParams, ctx: JobContext) => Promise<TResult>
}

/**
 * Kody błędów z SPEC §7a. Lista zamknięta: nowy tryb awarii to nowy kod
 * i nowy wpis w mapowaniu na komunikat, nigdy ogólne „wystąpił błąd".
 */
export const JOB_ERROR_CODES = [
  'COMFY_UNREACHABLE',
  'COMFY_WORKFLOW_INVALID',
  'OUT_OF_MEMORY',
  'JOB_TIMEOUT',
  'JOB_CANCELLED',
  'INTERRUPTED_BY_RESTART',
  'UPLOAD_TOO_LARGE',
  'UPLOAD_UNSUPPORTED_TYPE',
  'FFMPEG_FAILED',
  'EXPORT_WEIGHT_UNREACHABLE',
  'PROMPT_SERVICE_FAILED',
  /** Baza nie odpowiada — uszkodzony plik albo brak prawa zapisu. */
  'DATABASE_UNAVAILABLE',
  /** Eksport nie doszedł do skutku z powodu innego niż waga pliku. */
  'EXPORT_FAILED',
] as const

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number]

/**
 * Kody błędów warstwy API — osobne od kodów zadań, bo dotyczą żądania,
 * nie pracy w kolejce. Ta lista też jest zamknięta.
 *
 * [ZAŁOŻENIE] `HEALTH_CHECK_FAILED` nie występuje w tabeli w SPEC §7a.
 * Dopisany, bo `/api/health` może się wywrócić, a użytkownik nie może
 * zobaczyć treści wyjątku. Wymaga wpisu w SPEC.
 */
export const API_ERROR_CODES = [
  'HEALTH_CHECK_FAILED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  /** Ścieżka złożona z danych z bazy wyszła poza katalog danych. */
  'PATH_INVALID',
  'QUEUE_BUSY',
  /** Brak ważnej sesji — trzeba się zalogować. */
  'NOT_AUTHENTICATED',
  /** Złe hasło. Jeden komunikat na wszystkie przypadki. */
  'BAD_PASSWORD',
  /** Wyczerpany limit żądań w oknie czasowym. */
  'TOO_MANY_ATTEMPTS',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/**
 * Błąd warstwy API. Jak `JobError` niesie kod, nigdy treść dla użytkownika —
 * interfejs mapuje `code` na zdanie po polsku.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number

  constructor(code: ApiErrorCode, message: string, status = 400, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/**
 * Błąd niosący kod, nigdy treść przeznaczoną dla użytkownika.
 * Interfejs mapuje `code` na zdanie po polsku; `cause` zostaje w logu.
 */
export class JobError extends Error {
  readonly code: JobErrorCode

  constructor(code: JobErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'JobError'
    this.code = code
  }
}
