import { env, hasDarktable } from '@/lib/env'
import { isExecutable, runBinary } from './run-binary'
import { JobError, type HealthStatus, type JobContext } from './types'

/**
 * Adapter wsadowej obróbki zdjęć (SPEC §6, etap E6).
 *
 * [NIEPOTWIERDZONE] darktable prawdopodobnie nie znosi równoległych uruchomień
 * przez blokadę biblioteki — do zweryfikowania na maszynie, na której będzie
 * zainstalowany. Do tego czasu wywołania są serializowane po stronie serwisu.
 */

export interface PresetRequest {
  sourcePath: string
  /** Plik XMP z gradingiem. `null` oznacza samą konwersję bez presetu. */
  presetPath: string | null
  outputPath: string
}

function parseVersion(stdout: string): string | undefined {
  const match = /darktable\s+(\d+\.\d+\.\d+)/i.exec(stdout)
  return match?.[1]
}

export async function checkDarktable(): Promise<HealthStatus> {
  // Pusta zmienna to świadomy stan, nie awaria — darktable dotyczy dopiero E6.
  if (!hasDarktable) {
    return { ok: false, reason: 'missing_binary' }
  }

  if (!(await isExecutable(env.DARKTABLE_CLI_PATH))) {
    return { ok: false, reason: 'missing_binary' }
  }

  try {
    const result = await runBinary(env.DARKTABLE_CLI_PATH, ['--version'], { timeoutMs: 10_000 })
    if (result.code !== 0) {
      return { ok: false, reason: 'misconfigured' }
    }
    const version = parseVersion(result.stdout)
    return version === undefined ? { ok: true } : { ok: true, version }
  } catch {
    return { ok: false, reason: 'misconfigured' }
  }
}

/**
 * `darktable-cli <wejście> [preset.xmp] <wyjście>` na jednym pliku.
 * Zawsze tablica argumentów, nigdy powłoka — ścieżki pochodzą z bazy,
 * ale reguła obowiązuje niezależnie od tego, skąd pochodzą.
 */
export async function applyPreset(request: PresetRequest, ctx: JobContext): Promise<void> {
  if (!hasDarktable) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'darktable nie jest skonfigurowany')
  }

  const args =
    request.presetPath === null
      ? [request.sourcePath, request.outputPath]
      : [request.sourcePath, request.presetPath, request.outputPath]

  // `--core` oddziela argumenty darktable'a od reszty; bez tego binarka
  // interpretuje część ścieżek jako własne opcje.
  args.push('--core', '--disable-opencl')

  const result = await runBinary(env.DARKTABLE_CLI_PATH, args, {
    signal: ctx.signal,
    timeoutMs: 120_000,
  })

  if (result.code !== 0) {
    ctx.logger.error('darktable-cli zakończył się błędem', {
      code: result.code ?? -1,
      tail: result.stderr.slice(-500),
    })
    throw new JobError('COMFY_WORKFLOW_INVALID', `darktable-cli zwrócił kod ${result.code}`)
  }
}
