import type { LogContext, Logger, LogLevel } from '@/server/adapters/types'

/**
 * Logger aplikacji. `console.log` w kodzie oddawanym jest zakazany —
 * wszystko idzie tędy, zawsze z kontekstem: kto, co, jakie ID.
 *
 * Wypisujemy JSON w jednej linii, żeby dało się to filtrować `jq`-iem,
 * gdy stacja stoi bez opieki.
 */

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/**
 * Czytamy `process.env` wprost, nie przez `env`.
 *
 * `lib/env.ts` loguje problemy z konfiguracją, więc import w drugą stronę
 * dałby cykl. Wartość jest jednak walidowana schematem Zod w `env.ts` —
 * literówka zatrzymuje start, zanim ten kod się wykona.
 */
function resolveMinimumLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const MINIMUM_LEVEL = resolveMinimumLevel()

function write(level: LogLevel, base: LogContext, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MINIMUM_LEVEL]) return

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...base,
    ...context,
  })

  // Jedyne miejsce w kodzie, które sięga do strumieni procesu.
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`)
  } else {
    process.stdout.write(`${line}\n`)
  }
}

function build(base: LogContext): Logger {
  return {
    debug: (message, context) => write('debug', base, message, context),
    info: (message, context) => write('info', base, message, context),
    warn: (message, context) => write('warn', base, message, context),
    error: (message, context) => write('error', base, message, context),
    child: (context) => build({ ...base, ...context }),
  }
}

export const logger: Logger = build({})

/** Logger z doklejonym kontekstem, np. `createLogger({ jobId, orderId })`. */
export function createLogger(context: LogContext): Logger {
  return build(context)
}
