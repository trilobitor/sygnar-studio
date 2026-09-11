import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { env, hasFastVideo } from '@/lib/env'

import { JobError, type JobContext } from './types'

/**
 * Generowanie klipu z opisu — Wan 2.2 TI2V-5B przez FastVideo na MLX.
 *
 * Model liczy minutami, nie sekundami: zmierzone 11.09.2026 na tej maszynie
 * to **310 s** dla 720p i pięciu sekund oraz **26 s** dla 480p i dwóch.
 * Dlatego to zadanie kolejki, a nie narzędzie z paskiem postępu przy ekranie.
 *
 * Skalowanie jest nieliniowe — 720p/5s ma 6,7× więcej pikseli-klatek niż
 * 480p/2s, a trwa 11,8× dłużej. Stąd dwa warianty w interfejsie: szybki
 * podgląd kosztuje jedną dziesiątą czasu wersji do oddania.
 */

/** Ustawienia obu wariantów. Wartości zmierzone, nie oszacowane. */
export const WARIANTY_WIDEO = {
  podglad: { width: 832, height: 480, frames: 49, sekundy: 2, szacunekS: 30 },
  oddanie: { width: 1280, height: 704, frames: 121, sekundy: 5, szacunekS: 310 },
} as const

export type WariantWideo = keyof typeof WARIANTY_WIDEO

export interface ZadanieWideo {
  promptEn: string
  wariant: WariantWideo
  seed: number
  outputPath: string
}

/**
 * Postęp z wyjścia procesu.
 *
 * FastVideo sam nic nie wypisuje w trakcie liczenia — zmierzone, 24 sekundy
 * ciszy przy 480p i 234 przy 720p. Linie `[postep] krok N/M` dokłada nasz
 * skrypt w `spike/mlx_wan22_generate.py`; format jest umową między tym
 * skryptem a tym plikiem i zmiana w jednym wymaga zmiany w drugim.
 */
const POSTEP = /\[postep\] krok (\d+)\/(\d+)/

/** Etapy widoczne dla grafika. Kolejność jak w przebiegu. */
function etap(linia: string): string | null {
  if (linia.includes('prompt encoded')) return 'Opis zakodowany'
  if (linia.includes('decoded via')) return 'Składanie klipu'
  return null
}

export async function generujWideo(zadanie: ZadanieWideo, ctx: JobContext): Promise<void> {
  if (!hasFastVideo) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'generowanie wideo nie jest skonfigurowane')
  }

  const wariant = WARIANTY_WIDEO[zadanie.wariant]
  const python = join(env.FASTVIDEO_DIR, 'venv', 'bin', 'python')
  const wagi = join(env.FASTVIDEO_DIR, 'wagi', 'FastMetal-5B-QAD')

  const args = [
    'spike/mlx_wan22_generate.py',
    '--mlx-checkpoint', wagi,
    '--dit-config', join(wagi, 'mlx_dit.json'),
    '--text-encoder-root', wagi,
    '--vae-root', join(wagi, 'vae'),
    '--height', String(wariant.height),
    '--width', String(wariant.width),
    '--num-frames', String(wariant.frames),
    '--fps', '24',
    '--seed', String(zadanie.seed),
    '--prompt', zadanie.promptEn,
    '--output-path', zadanie.outputPath,
  ]

  await new Promise<void>((resolve, reject) => {
    // Zawsze tablica argumentów, nigdy powłoka: opis sceny pochodzi od
    // grafika i trafia tu jako jeden argument, nie jako fragment komendy.
    const child = spawn(python, args, {
      shell: false,
      cwd: process.cwd(),
      // Python musi pisać na bieżąco, inaczej postęp przyjdzie dopiero na końcu.
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })

    let stderrTail = ''
    let settled = false
    let powodPrzerwania: JobError | null = null

    /*
     * SIGTERM, po sekundzie SIGKILL, rozstrzygnięcie dopiero z `close`.
     *
     * Zmierzone 11.09.2026: po SIGTERM proces znika w 1,1 s, a pamięć wraca
     * natychmiast — wolne 7,3 GB przed, 21,7 GB po. Kolejka nie musi więc
     * odczekiwać przed puszczeniem następnego zadania.
     */
    function onAbort(): void {
      powodPrzerwania = new JobError('JOB_CANCELLED', 'zadanie anulowane')

      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1000).unref()
    }

    if (ctx.signal.aborted) onAbort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    function czytaj(buffer: Buffer): void {
      const tekst = buffer.toString('utf8')
      stderrTail = `${stderrTail}${tekst}`.slice(-4000)

      for (const linia of tekst.split('\n')) {
        const krok = POSTEP.exec(linia)

        if (krok !== null) {
          const numer = Number(krok[1])
          const ile = Number(krok[2])
          ctx.onProgress({
            // Liczenie to główna część przebiegu, ale nie całość: przed nim
            // jest kodowanie opisu, po nim składanie klipu.
            percent: 0.15 + (numer / ile) * 0.75,
            phase: `Liczenie obrazu — krok ${String(numer)} z ${String(ile)}`,
          })
          continue
        }

        const nazwa = etap(linia)
        if (nazwa !== null) {
          ctx.onProgress({ percent: nazwa === 'Opis zakodowany' ? 0.15 : 0.92, phase: nazwa })
        }
      }
    }

    child.stdout.on('data', czytaj)
    child.stderr.on('data', czytaj)

    const zakoncz = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    child.on('error', (blad) => {
      zakoncz(() =>
        reject(new JobError('COMFY_WORKFLOW_INVALID', 'nie udało się uruchomić generatora wideo', { cause: blad })),
      )
    })

    child.on('close', (kod) => {
      zakoncz(() => {
        if (powodPrzerwania !== null) return reject(powodPrzerwania)
        if (kod === 0) return resolve()

        ctx.logger.error('generator wideo zakończył się błędem', {
          code: kod ?? -1,
          tail: stderrTail.slice(-500),
        })
        reject(new JobError('COMFY_WORKFLOW_INVALID', `generator wideo zwrócił kod ${String(kod)}`))
      })
    })
  })
}
