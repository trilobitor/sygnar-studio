import { spawn } from 'node:child_process'
import { access, constants, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { env } from '@/lib/env'
import { isExecutable } from './run-binary'
import { JobError, type HealthStatus, type JobContext } from './types'
import { IMAGE_EDIT_WORKFLOW, loadWorkflow, TEXT_TO_IMAGE_WORKFLOW } from './workflow'

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

export interface EditParams {
  /** Ścieżka bezwzględna do kadru, który poprawiamy. */
  sourcePath: string
  /** Opis zmiany po angielsku — co ma wyjść inaczej. */
  instructionEn: string
  /** Numer losowania; ten sam numer i ten sam opis dają ten sam wynik. */
  seed: number
  width: number
  height: number
}

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
/**
 * Ścieżka do binarki mfluxa.
 *
 * Nazwa pochodzi z presetu w `workflows/`, a nie ze stałej w kodzie — od kiedy
 * poza generowaniem doszło poprawianie kadru, są dwie różne binarki i to plik
 * presetu mówi, której użyć.
 */
export function generatorPath(nazwa: string = MFLUX_GENERATOR): string {
  return join(env.MFLUX_BIN_DIR, nazwa)
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

/**
 * Rozpoznaje wyczerpanie pamięci w tekście błędu, żeby dać właściwy kod.
 *
 * Doszły dwa wzorce, których wcześniej nie było, a które na tej maszynie są
 * najczęstsze: `MemoryError` z Pythona i `Killed: 9` — tak wygląda ubicie
 * procesu przez system przy braku pamięci, bez żadnego komunikatu od MLX.
 * Bez nich oba te przypadki dostawały kod od zupełnie innej awarii.
 */
export function looksLikeOutOfMemory(text: string): boolean {
  return /out of memory|insufficient memory|cannot allocate|metal.*allocat|memoryerror|killed:?\s*9\b/i.test(
    text,
  )
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

/**
 * Uruchomienie binarki mfluxa i przetłumaczenie jej wyjścia na postęp zadania.
 *
 * Wyodrębnione, bo generowanie i poprawianie kadru różnią się wyłącznie listą
 * argumentów i etykietą etapu. Cała reszta — przerywanie przez `SIGTERM`,
 * rozstrzyganie dopiero po śmierci procesu, rozpoznawanie braku pamięci —
 * jest wspólna i nie ma powodu, żeby istniała w dwóch kopiach.
 */
async function uruchomMflux(
  binarka: string,
  args: string[],
  ctx: JobContext,
  postep: { krokiRazem: number; etykieta: (krok: number) => string },
): Promise<void> {
  let stderrTail = ''

  await new Promise<void>((resolvePromise, rejectPromise) => {
    // Zawsze tablica argumentów, nigdy powłoka (SPEC §13).
    const child = spawn(binarka, args, { shell: false })

    let settled = false
    /** Ustawiany przez `onAbort`, odczytywany w handlerze `close`. */
    let powodPrzerwania: JobError | null = null

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener('abort', onAbort)
      fn()
    }

    function onAbort(): void {
      powodPrzerwania = new JobError('JOB_CANCELLED', 'zadanie anulowane')

      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 1000)
    }

    ctx.signal.addEventListener('abort', onAbort)

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)

      const progress = parseStepProgress(chunk)
      if (progress === null) return

      ctx.onProgress({
        percent: Math.min(progress.step / postep.krokiRazem, 1),
        phase: postep.etykieta(progress.step),
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
        // Przerwanie rozstrzyga się dopiero tutaj — proces już nie żyje,
        // więc wywołujący może bezpiecznie sprzątnąć katalog.
        if (powodPrzerwania !== null) {
          rejectPromise(powodPrzerwania)
          return
        }

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
    /** Ustawiany przez `onAbort`, odczytywany w handlerze `close`. */
    let powodPrzerwania: JobError | null = null

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener('abort', onAbort)
      fn()
    }

    /**
     * Powód przerwania zapamiętany, rozstrzygnięcie **po zamknięciu procesu**.
     *
     * Wcześniej obietnica była odrzucana od razu w tym miejscu, a proces
     * dopiero zaczynał umierać. Wywołujący ruszał dalej — na przykład kasował
     * katalog — podczas gdy dziecko jeszcze do niego pisało. Ten sam wyścig
     * trzeba było potem łatać czekaniem w handlerze kasowania zlecenia.
     *
     * `SIGTERM` przed `SIGKILL`: ffmpeg domyka wtedy plik, a mflux zwalnia
     * pamięć GPU. Sekunda na uprzejmość wystarcza obu.
     */
    function onAbort(): void {
      powodPrzerwania = new JobError('JOB_CANCELLED', 'zadanie anulowane')

      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1000).unref()
    }

    // Sygnał mógł nadejść, zanim tu doszliśmy. Nie wracamy od razu —
    // rozstrzygnięcie i tak przyjdzie z handlera `close`, po śmierci procesu.
    if (ctx.signal.aborted) {
      onAbort()
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
        // Przerwanie rozstrzyga się dopiero tutaj — proces już nie żyje,
        // więc wywołujący może bezpiecznie sprzątnąć katalog.
        if (powodPrzerwania !== null) {
          rejectPromise(powodPrzerwania)
          return
        }

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

/**
 * Poprawka istniejącego kadru.
 *
 * Model dostaje kadr źródłowy i zdanie mówiące, **co zmienić** — resztę ma
 * zostawić. Zmierzone na tej maszynie: kadr 1024 × 1344, cztery kroki, 108 s
 * i szczyt 17,50 GB. To mniej niż generowanie od zera (27,81 GB), ale wciąż
 * dość, żeby trzymać to w tej samej puli jednego zadania GPU naraz.
 */
export async function editImage(params: EditParams, ctx: JobContext): Promise<GeneratedImage> {
  const workflow = loadWorkflow(IMAGE_EDIT_WORKFLOW)
  const outputBase = join(ctx.workDir, `poprawka_seed_${String(params.seed)}.png`)

  const args = [
    '--model',
    workflow.model,
    '--image-paths',
    params.sourcePath,
    '--prompt',
    params.instructionEn,
    '--seed',
    String(params.seed),
    '--steps',
    String(workflow.steps),
    '--guidance',
    String(workflow.guidance),
    '--metadata',
    '--output',
    outputBase,
  ]

  ctx.logger.info('start poprawiania kadru', {
    seed: params.seed,
    steps: workflow.steps,
  })

  await uruchomMflux(generatorPath(workflow.generator), args, ctx, {
    krokiRazem: workflow.steps,
    etykieta: () => 'Poprawiam kadr',
  })

  /*
   * Mflux dokleja `_seed_<numer>` także tutaj, mimo że numer jest jeden —
   * ta sama pułapka, która przy generowaniu dała nazwy `kadr_seed_1_seed_1.png`.
   * Sprawdzamy obie postacie zamiast zakładać którąkolwiek.
   */
  const dir = dirname(outputBase)
  const obecne = new Set(await readdir(dir))
  const kandydaci = [
    basename(outputBase),
    basename(outputBase).replace(/\.png$/, `_seed_${String(params.seed)}.png`),
  ]
  const nazwa = kandydaci.find((k) => obecne.has(k))

  if (nazwa === undefined) {
    throw new JobError('COMFY_WORKFLOW_INVALID', 'poprawka nie zapisała pliku wyjściowego')
  }

  return {
    seed: params.seed,
    path: join(dir, nazwa),
    width: params.width,
    height: params.height,
    metadata: await readSidecar(join(dir, nazwa.replace(/\.png$/, '.metadata.json'))),
  }
}
