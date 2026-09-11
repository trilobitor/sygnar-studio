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
    /*
     * Sygnału NIE oddajemy `spawn`. Node przy `abort()` wysyła wyłącznie
     * SIGTERM i **natychmiast** emituje `error: AbortError`, więc obietnica
     * odrzucała się, zanim dziecko zdążyło umrzeć — bez eskalacji do
     * SIGKILL. Proces, który SIGTERM-a nie uzna, żył dalej i dopisywał plik
     * już po anulowaniu zadania: osierocony plik bez wiersza w bazie,
     * zderzający się potem z numeracją następnego wsadu (SYG-107).
     *
     * Obsługa jest niżej, wzorem `ffmpeg.ts` i `mflux.ts`, gdzie stoi
     * poprawnie od początku — ten adapter był jedynym z trzech bez niej.
     */
    const child = spawn(path, [...args], {
      shell: false,
      cwd: options.cwd,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    /** Ustawiane przy anulowaniu; rozstrzyga dopiero handler `close`. */
    let powodPrzerwania: Error | null = null

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

    function onAbort(): void {
      powodPrzerwania = new Error('przerwane sygnałem')

      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1000).unref()
    }

    // Sygnał mógł nadejść, zanim tu doszliśmy. Nie wracamy od razu —
    // rozstrzygnięcie przyjdzie z handlera `close`, po śmierci procesu.
    if (options.signal?.aborted === true) {
      onAbort()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      finish(() => reject(error))
    })

    child.on('close', (code) => {
      // Przerwanie rozstrzygamy dopiero tutaj, czyli po śmierci dziecka.
      finish(() =>
        powodPrzerwania === null
          ? resolve({ code, stdout, stderr })
          : reject(powodPrzerwania),
      )
    })
  })
}
