import { spawn } from 'node:child_process'

import { z } from 'zod'

import { env } from '@/lib/env'
import { isExecutable } from './run-binary'
import { JobError, type HealthStatus, type Logger } from './types'

/**
 * Warstwa promptowa przez Claude Code CLI.
 *
 * Alternatywa dla klucza API: `claude -p` korzysta z poświadczeń zapisanych
 * przez `claude` przy logowaniu, czyli z subskrypcji, którą właściciel już ma.
 * Osobny klucz API nie jest potrzebny.
 *
 * [ZAŁOŻENIE] Wywołania liczą się do limitów planu subskrypcyjnego, a nie do
 * osobnego rachunku. Pole `total_cost_usd` w odpowiedzi to przelicznik
 * podawany przez CLI, nie kwota do zapłacenia — zapisujemy je w `prompt_runs`
 * jako miarę zużycia, nie jako koszt.
 *
 * Narzędzia są wyłączone (`--allowed-tools ""`), bo to zadanie tekstowe:
 * model ma zamienić brief na opis sceny, a nie sięgać po pliki czy sieć.
 */

/** Domyślna ścieżka. Nadpisywalna zmienną `CLAUDE_CLI_PATH`. */
const DEFAULT_CLI_PATH = '/opt/homebrew/bin/claude'

const TIMEOUT_MS = 120_000

/** Kształt odpowiedzi `--output-format json`. Sprawdzamy tylko to, czego używamy. */
const cliResultSchema = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string(),
  total_cost_usd: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
})

export type CliResult = z.infer<typeof cliResultSchema>

export function cliPath(): string {
  return env.CLAUDE_CLI_PATH.length > 0 ? env.CLAUDE_CLI_PATH : DEFAULT_CLI_PATH
}

export async function checkClaudeCli(): Promise<HealthStatus> {
  return (await isExecutable(cliPath())) ? { ok: true } : { ok: false, reason: 'missing_binary' }
}

/**
 * Uruchamia CLI i oddaje surową odpowiedź modelu.
 * Rzuca `PROMPT_SERVICE_FAILED` — wywołujący ma wtedy sięgnąć po składacz
 * deterministyczny albo pokazać pole do ręcznego wpisania.
 */
export function runClaudeCli(
  userMessage: string,
  systemPrompt: string,
  logger: Logger,
): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      '-p',
      userMessage,
      '--system-prompt',
      systemPrompt,
      // Zadanie jest czysto tekstowe — model nie ma powodu dotykać dysku.
      '--allowed-tools',
      '',
      '--output-format',
      'json',
    ]

    // Zawsze tablica argumentów, nigdy powłoka (SPEC §13).
    const child = spawn(cliPath(), args, {
      shell: false,
      // Katalog roboczy poza projektem: CLI nie ma po co widzieć naszych
      // plików, a brief jest danymi, nie zaproszeniem do przeglądania repo.
      cwd: '/tmp',
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, TIMEOUT_MS)

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000)
    })

    child.on('error', (error) => {
      finish(() =>
        rejectPromise(
          new JobError('PROMPT_SERVICE_FAILED', 'nie udało się uruchomić Claude Code', {
            cause: error,
          }),
        ),
      )
    })

    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          logger.warn('Claude Code zakończył się błędem', {
            code: code ?? -1,
            tail: stderr.slice(-300),
          })
          rejectPromise(new JobError('PROMPT_SERVICE_FAILED', `CLI zwróciło kod ${code}`))
          return
        }

        try {
          const parsed = cliResultSchema.parse(JSON.parse(extractJsonObject(stdout)))

          if (parsed.is_error) {
            rejectPromise(new JobError('PROMPT_SERVICE_FAILED', 'CLI zgłosiło błąd'))
            return
          }

          resolvePromise(parsed)
        } catch (error) {
          rejectPromise(
            new JobError('PROMPT_SERVICE_FAILED', 'odpowiedź CLI nie da się odczytać', {
              cause: error,
            }),
          )
        }
      })
    })
  })
}

/**
 * Wycina obiekt JSON ze strumienia. CLI potrafi dopisać linię ostrzeżenia
 * przed właściwą odpowiedzią, więc nie zakładamy, że stdout to czysty JSON.
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start === -1 || end === -1 || end < start) {
    throw new Error('brak obiektu JSON w odpowiedzi')
  }

  return text.slice(start, end + 1)
}
