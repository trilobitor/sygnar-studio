import { spawn } from 'node:child_process'
import { access, constants, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { env } from '@/lib/env'
import { isExecutable } from './run-binary'
import { JobError, type HealthStatus, type JobContext } from './types'
import { loadWorkflow, TEXT_TO_IMAGE_WORKFLOW } from './workflow'

/**
 * Adapter generowania obrazów (decyzja D5).
 *
 * Backendem wersji 1 jest mflux, bo ComfyUI nie stoi na maszynie docelowej,
 * a jego oficjalna ścieżka instalacji FLUX.2 klein 4B prowadzi na pliki fp8,
 * których backend MPS PyTorcha nie obsługuje. Kontrakt adaptera zostaje
 * nietknięty, więc ComfyUI dołoży się później jako druga implementacja.
 *
 * Kroki i guidance pochodzą z `workflows/flux2-klein-t2i.json`. Ten plik
 * jest jedynym miejscem, w którym te liczby żyją.
 */

export const MFLUX_GENERATOR = 'mflux-generate-flux2'

export interface GenerateParams {
  promptEn: string
  width: number
  height: number
  seeds: number[]
}

export interface GeneratedImage {
  seed: number
  /** Ścieżka bezwzględna do pliku PNG w katalogu roboczym zadania. */
  path: string
  width: number
  height: number
  /** Zawartość sidecara `*.metadata.json`, jeśli mflux go zapisał. */
  metadata: Record<string, unknown> | null
}

/** Ścieżka do binarki generatora, złożona ze zmiennej środowiskowej. */
export function generatorPath(): string {
  return join(env.MFLUX_BIN_DIR, MFLUX_GENERATOR)
}

/**
 * Wersja mfluxa odczytana z katalogu `dist-info` w środowisku wirtualnym.
 * Odczyt jest tani; uruchomienie binarki z `--help` kosztowałoby kilka sekund
 * importów, a `/api/health` odpytuje się przy każdym wejściu na stronę.
 */
async function readVersion(): Promise<string | undefined> {
  // `MFLUX_BIN_DIR` to `<venv>/bin`, więc pakiety leżą piętro wyżej.
  const venvRoot = join(env.MFLUX_BIN_DIR, '..')
  try {
    const libDir = join(venvRoot, 'lib')
    const pythonDirs = await readdir(libDir)
    for (const pythonDir of pythonDirs) {
      const packages = await readdir(join(libDir, pythonDir, 'site-packages'))
      const distInfo = packages.find(
        (name) => name.startsWith('mflux-') && name.endsWith('.dist-info'),
      )
      if (distInfo !== undefined) {
        return distInfo.slice('mflux-'.length, -'.dist-info'.length)
      }
    }
  } catch {
    // Brak wersji nie jest awarią — adapter dalej może działać.
  }
  return undefined
}

/**
 * Katalog wag modelu w pamięci podręcznej HuggingFace.
 *
 * Nazwa repozytorium zamieniona na katalog wedle konwencji HF:
 * `org/model` → `models--org--model`.
 */
function katalogWag(): string {
  const dom = process.env.HOME ?? ''
  const cache = process.env.HF_HOME ?? join(dom, '.cache', 'huggingface')
  return join(cache, 'hub', 'models--black-forest-labs--FLUX.2-klein-4B')
}

export async function checkMflux(): Promise<HealthStatus> {
  const path = generatorPath()

  if (!(await isExecutable(path))) {
    return { ok: false, reason: 'missing_binary' }
  }

  /*
   * Sama binarka nie wystarcza.
   *
   * `mflux-generate-flux2 --version` odpowiada także wtedy, gdy wag nie ma
   * wcale — pierwsze generowanie zaczynało się wtedy od kilkunastu gigabajtów
   * pobierania, a panel przez cały ten czas meldował „Generowanie obrazów: ok"
   * i pokazywał pasek postępu, który nie ruszał.
   */
  try {
    await access(katalogWag(), constants.R_OK)
  } catch {
    return { ok: false, reason: 'misconfigured' }
  }

  const version = await readVersion()
  return version === undefined ? { ok: true } : { ok: true, version }
}

/**
 * Ostatni postęp z linii `tqdm`. Wyjście leci na stderr i jest rozdzielone
 * powrotami karetki, więc jedna „linia" bywa całą historią paska naraz.
 */
export function parseStepProgress(chunk: string): { step: number; total: number } | null {
  const matches = [...chunk.matchAll(/(\d+)\/(\d+)\s*\[/g)]
  const last = matches.at(-1)
  if (last === undefined) return null

  const step = Number(last[1])
  const total = Number(last[2])
  if (!Number.isFinite(step) || !Number.isFinite(total) || total === 0) return null

  return { step, total }
}

/** Rozpoznaje wyczerpanie pamięci w tekście błędu, żeby dać właściwy kod. */
export function looksLikeOutOfMemory(text: string): boolean {
  return /out of memory|insufficient memory|cannot allocate|metal.*allocat/i.test(text)
}

/**
 * Generuje warianty. Wszystkie seedy idą jednym uruchomieniem, bo załadowanie
 * modelu kosztuje kilkanaście sekund i nie ma powodu płacić tego raz na wariant.
 *
 * Zmierzone w E0 na tej maszynie: ~30 s i 17,95 GB przy 1,11 Mpx,
 * ~93 s i 27,81 GB przy 2,08 Mpx. Stąd jedno zadanie GPU naraz.
 */
/**
 * Wzorzec nazwy pliku podawany mfluxowi.
 *
 * mflux sam dokleja `_seed_{seed}` do rdzenia nazwy, ale **wyłącznie gdy
 * numerów jest więcej niż jeden** — patrz `cli/parser/parsers.py`:
 * `if ... len(namespace.seed) > 1: output.with_stem(stem + "_seed_{seed}")`.
 *
 * Wcześniej podawaliśmy `kadr_seed_{seed}.png` zawsze. Przy jednym numerze
 * wychodziło poprawnie i tak to sprawdziłem — ale przy czterech wariantach,
 * czyli w normalnej pracy, mflux doklejał przyrostek **na wierzch** i pliki
 * nazywały się `kadr_seed_123_seed_123.png`. Adapter szukał nazwy bez
 * powtórzenia, nie znajdował i przerywał zadanie kodem COMFY_WORKFLOW_INVALID.
 *
 * Obie gałęzie dają ten sam wynik końcowy: `kadr_seed_<numer>.png`.
 */
export function nazwaWyjscia(ileSeedow: number): string {
  return ileSeedow > 1 ? 'kadr.png' : 'kadr_seed_{seed}.png'
}

export async function generate(
  params: GenerateParams,
  ctx: JobContext,
): Promise<GeneratedImage[]> {
  const workflow = loadWorkflow(TEXT_TO_IMAGE_WORKFLOW)
  const outputBase = join(ctx.workDir, nazwaWyjscia(params.seeds.length))

  const args = [
    '--model',
    workflow.model,
    '--prompt',
    params.promptEn,
    '--seed',
    ...params.seeds.map(String),
    '--steps',
    String(workflow.steps),
    '--guidance',
    String(workflow.guidance),
    '--width',
    String(params.width),
    '--height',
    String(params.height),
    '--metadata',
    '--output',
    outputBase,
  ]

  const totalSteps = workflow.steps * params.seeds.length
  let completedSeeds = 0
  let lastStepInSeed = 0
  let stderrTail = ''

  ctx.logger.info('start generowania', {
    seeds: params.seeds.join(','),
    width: params.width,
    height: params.height,
    steps: workflow.steps,
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    // Zawsze tablica argumentów, nigdy powłoka (SPEC §13).
    const child = spawn(generatorPath(), args, { shell: false })

    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener('abort', onAbort)
      fn()
    }

    function onAbort(): void {
      child.kill('SIGKILL')
      finish(() => rejectPromise(new JobError('JOB_CANCELLED', 'zadanie anulowane')))
    }

    if (ctx.signal.aborted) {
      onAbort()
      return
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    child.stderr.on('data', (buffer: Buffer) => {
      const chunk = buffer.toString('utf8')
      // Trzymamy ogon na wypadek błędu — do logu, nigdy do użytkownika.
      stderrTail = `${stderrTail}${chunk}`.slice(-4000)

      const progress = parseStepProgress(chunk)
      if (progress === null) return

      // Pasek zaczyna się od nowa przy każdym seedzie, więc cofnięcie się
      // numeru kroku oznacza, że poprzedni wariant się skończył.
      if (progress.step < lastStepInSeed) {
        completedSeeds += 1
      }
      lastStepInSeed = progress.step

      const done = completedSeeds * workflow.steps + progress.step
      const variantNumber = Math.min(completedSeeds + 1, params.seeds.length)

      ctx.onProgress({
        percent: Math.min(done / totalSteps, 1),
        phase:
          params.seeds.length === 1
            ? 'Rysuję kadr'
            : `Rysuję kadr ${variantNumber} z ${params.seeds.length}`,
      })
    })

    child.on('error', (error) => {
      finish(() =>
        rejectPromise(
          new JobError('COMFY_UNREACHABLE', 'nie udało się uruchomić generatora', {
            cause: error,
          }),
        ),
      )
    })

    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolvePromise()
          return
        }

        ctx.logger.error('generator zakończył się błędem', {
          code: code ?? -1,
          tail: stderrTail.slice(-500),
        })

        if (looksLikeOutOfMemory(stderrTail)) {
          rejectPromise(new JobError('OUT_OF_MEMORY', 'zabrakło pamięci'))
          return
        }

        rejectPromise(new JobError('COMFY_WORKFLOW_INVALID', `generator zwrócił kod ${code}`))
      })
    })
  })

  return collectOutputs(outputBase, params)
}

/**
 * Zbiera pliki wyjściowe po dokładnych nazwach.
 *
 * Żadnego wariantu awaryjnego: jeśli pliku o oczekiwanej nazwie nie ma, to
 * znaczy, że coś poszło inaczej, niż zakładamy, i lepiej zatrzymać zadanie,
 * niż zarejestrować cudzy kadr pod tym numerem losowania.
 */
async function collectOutputs(
  outputBase: string,
  params: GenerateParams,
): Promise<GeneratedImage[]> {
  const dir = dirname(outputBase)
  const wzor = basename(outputBase)
  const present = new Set(await readdir(dir))

  const images: GeneratedImage[] = []

  for (const seed of params.seeds) {
    // Przy wielu numerach wzorcem jest gołe `kadr.png`, bo przyrostek dokleja
    // mflux; przy jednym numerze wzorzec sam niesie `{seed}`. Obie ścieżki
    // prowadzą do tej samej nazwy.
    const fileName = wzor.includes('{seed}')
      ? wzor.replace('{seed}', String(seed))
      : wzor.replace(/\.png$/, `_seed_${seed}.png`)

    if (!present.has(fileName)) {
      throw new JobError(
        'COMFY_WORKFLOW_INVALID',
        `brak pliku wyjściowego ${fileName} dla seeda ${seed}`,
      )
    }

    images.push({
      seed,
      path: join(dir, fileName),
      width: params.width,
      height: params.height,
      metadata: await readSidecar(join(dir, fileName.replace(/\.png$/, '.metadata.json'))),
    })
  }

  return images
}

async function readSidecar(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    // Sprawdzenie tuż obok zawęża `unknown` do obiektu, ale TypeScript nie
    // przenosi tego zawężenia przez operator warunkowy na typ indeksowany.
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    // Brak sidecara nie unieważnia obrazu — seed i tak znamy z parametrów.
    return null
  }
}
