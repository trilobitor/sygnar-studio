import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'

/**
 * Uruchamianie procesów potomnych. Zawsze `spawn` z tablicą argumentów,
 * nigdy powłoka i nigdy sklejanie stringów — nazwa pliku od użytkownika
 * w komendzie powłoki to wykonanie dowolnego kodu (SPEC §13).
 */

export interface BinaryResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Czy plik istnieje i ma bit wykonywalności. */
export async function isExecutable(path: string): Promise<boolean> {
  if (path.length === 0) return false
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    // Brak pliku albo brak uprawnień — dla wywołującego to ta sama odpowiedź.
    return false
  }
}

/**
 * Uruchamia binarkę i zbiera wyjście. `shell` pozostaje wyłączone —
 * to nie jest ustawienie do zmiany.
 */
export function runBinary(
  path: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number; cwd?: string } = {},
): Promise<BinaryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, [...args], {
      shell: false,
      cwd: options.cwd,
      signal: options.signal,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGKILL')
          }, options.timeoutMs)

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      fn()
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      finish(() => reject(error))
    })

    child.on('close', (code) => {
      finish(() => resolve({ code, stdout, stderr }))
    })
  })
}
