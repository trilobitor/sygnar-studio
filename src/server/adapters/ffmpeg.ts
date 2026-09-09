import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

import { env } from '@/lib/env'
import { isExecutable, runBinary } from './run-binary'
import { JobError, type HealthStatus, type JobContext } from './types'

/**
 * Adapter montażu wideo (SPEC §6, etap E5).
 *
 * Uruchamiany przez `spawn` z tablicą argumentów, nigdy przez powłokę —
 * nazwa pliku od użytkownika w komendzie powłoki to wykonanie dowolnego kodu.
 * Postęp parsowany ze `stderr`.
 *
 * Montaż jest parametryczny: przycięcie, pętla, kadr, poster, eksport.
 * Nie ma osi czasu, warstw ani klatek kluczowych — to świadomie poza wersją 1.
 */

export type CropAspect = 'vertical' | 'square' | 'horizontal'

/**
 * Enkodery dla drugiego pliku, w kolejności od najlepszego.
 *
 * `libaom-av1` był tu wpisany na sztywno i **nie istnieje w Homebrew ffmpeg 9**
 * — montaż padał za każdym razem komunikatem „Unknown encoder". Wybieramy więc
 * po tym, co realnie jest w binarce, a wybór zapisujemy w metadanych pliku.
 *
 * Opcje różnią się per enkoder: `-cpu-used` i `-row-mt` należą do libaom i libvpx,
 * SVT-AV1 steruje się `-preset`. Podanie cudzych opcji kończy się błędem.
 */
const KODEKI_DRUGIEGO_PLIKU = [
  { nazwa: 'libsvtav1', opcje: ['-preset', '8'], kontener: 'webm' },
  { nazwa: 'libaom-av1', opcje: ['-cpu-used', '6', '-row-mt', '1'], kontener: 'webm' },
  { nazwa: 'libvpx-vp9', opcje: ['-cpu-used', '4', '-row-mt', '1'], kontener: 'webm' },
] as const

export type NazwaKodeka = (typeof KODEKI_DRUGIEGO_PLIKU)[number]['nazwa']

/** Lista enkoderów binarki. Odczyt jest wolny, więc pytamy raz na proces. */
const globalForEncoders = globalThis as unknown as { studioEncoders?: Set<string> }

async function dostepneEnkodery(): Promise<Set<string>> {
  if (globalForEncoders.studioEncoders !== undefined) return globalForEncoders.studioEncoders

  const zbior = new Set<string>()
  try {
    const wynik = await runBinary(env.FFMPEG_PATH, ['-hide_banner', '-encoders'], {
      timeoutMs: 10_000,
    })
    for (const linia of wynik.stdout.split('\n')) {
      // Format: ` V..... nazwa   opis`
      const dopasowanie = /^\s*[A-Z.]{6}\s+(\S+)/.exec(linia)
      if (dopasowanie?.[1] !== undefined) zbior.add(dopasowanie[1])
    }
  } catch {
    // Brak listy nie może zatrzymać montażu — spróbujemy pierwszego z listy.
  }

  globalForEncoders.studioEncoders = zbior
  return zbior
}

/**
 * Pierwszy enkoder, który realnie jest w tej binarce.
 * Gdy lista jest pusta (nie udało się jej odczytać), bierzemy pierwszy z brzegu.
 */
export async function wybierzKodek(): Promise<(typeof KODEKI_DRUGIEGO_PLIKU)[number]> {
  const dostepne = await dostepneEnkodery()
  if (dostepne.size === 0) return KODEKI_DRUGIEGO_PLIKU[0]
  return KODEKI_DRUGIEGO_PLIKU.find((k) => dostepne.has(k.nazwa)) ?? KODEKI_DRUGIEGO_PLIKU[0]
}

export interface TrimOperation {
  kind: 'trim'
  startMs: number
  endMs: number
}

export interface LoopOperation {
  kind: 'loop'
  pingPong: boolean
}

export interface CropOperation {
  kind: 'crop'
  aspect: CropAspect
}

export type VideoOperation = TrimOperation | LoopOperation | CropOperation

/** Proporcje kadru docelowego. Środek kadru zostaje, boki schodzą. */
const CROP_EXPRESSIONS: Record<CropAspect, string> = {
  // `min()` pilnuje, żeby wycinek nie wyszedł poza oryginał.
  vertical: "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'",
  square: "crop='min(iw,ih)':'min(ih,iw)'",
  horizontal: "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'",
}

function ffprobePath(): string {
  return join(dirname(env.FFMPEG_PATH), 'ffprobe')
}

function parseVersion(stdout: string): string | undefined {
  const firstLine = stdout.split('\n', 1)[0]
  if (firstLine === undefined) return undefined
  const match = /^ffmpeg version (\S+)/.exec(firstLine)
  return match?.[1]
}

export async function checkFfmpeg(): Promise<HealthStatus> {
  if (!(await isExecutable(env.FFMPEG_PATH))) {
    return { ok: false, reason: 'missing_binary' }
  }

  // Montaż woła ffprobe równie często jak ffmpeg — bez niego nie ma ani
  // długości klipu, ani postępu, ani wymiarów przy wgrywaniu. Sprawdzenie
  // samego ffmpeg meldowało „Montaż wideo: ok" przy nieobecnym ffprobe.
  if (!(await isExecutable(ffprobePath()))) {
    return { ok: false, reason: 'missing_binary' }
  }

  try {
    const result = await runBinary(env.FFMPEG_PATH, ['-version'], { timeoutMs: 5_000 })
    if (result.code !== 0) {
      return { ok: false, reason: 'misconfigured' }
    }

    // `-version` mówi wyłącznie, że binarka się uruchamia. Montaż potrzebuje
    // konkretnych enkoderów, a ffmpeg z Homebrew bywa budowany bez nich —
    // wtedy zadanie padało dopiero po minutach pracy, z pustym plikiem.
    const dostepne = await dostepneEnkodery()

    if (!dostepne.has('libx264')) {
      return { ok: false, reason: 'misconfigured' }
    }

    if (![...KODEKI_DRUGIEGO_PLIKU].some((k) => dostepne.has(k.nazwa))) {
      return { ok: false, reason: 'misconfigured' }
    }

    const version = parseVersion(result.stdout)
    return version === undefined ? { ok: true } : { ok: true, version }
  } catch {
    // Binarka jest, ale nie daje się uruchomić — to konfiguracja, nie brak pliku.
    return { ok: false, reason: 'misconfigured' }
  }
}

/** Długość klipu w milisekundach. Potrzebna do postępu i do liczenia bitrate'u. */
export async function probeDurationMs(path: string): Promise<number | null> {
  try {
    const result = await runBinary(
      ffprobePath(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        path,
      ],
      { timeoutMs: 15_000 },
    )

    if (result.code !== 0) return null

    const seconds = Number.parseFloat(result.stdout.trim())
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
  } catch {
    // Brak ffprobe nie blokuje montażu — tracimy tylko dokładny postęp.
    return null
  }
}

/**
 * Wymiary i długość wgranego filmu.
 *
 * Bez tego panel montażu nie wie, jak długi jest materiał, więc nie potrafi
 * pokazać suwaka przycięcia — a `trim` jest w SPEC §"Oś czasu wideo" jedną
 * z trzech wymaganych operacji. Jedno wywołanie ffprobe zamiast dwóch, bo
 * i tak pytamy ten sam plik.
 */
export async function probeVideo(
  path: string,
): Promise<{ durationMs: number | null; width: number | null; height: number | null }> {
  const puste = { durationMs: null, width: null, height: null }

  try {
    const result = await runBinary(
      ffprobePath(),
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1',
        path,
      ],
      { timeoutMs: 15_000 },
    )

    if (result.code !== 0) return puste

    const pole = (nazwa: string): number | null => {
      const trafienie = new RegExp(`^${nazwa}=(.+)$`, 'm').exec(result.stdout)
      if (trafienie?.[1] === undefined) return null
      const liczba = Number.parseFloat(trafienie[1])
      return Number.isFinite(liczba) ? liczba : null
    }

    const sekundy = pole('duration')
    const szerokosc = pole('width')
    const wysokosc = pole('height')

    return {
      durationMs: sekundy === null ? null : Math.round(sekundy * 1000),
      width: szerokosc === null ? null : Math.round(szerokosc),
      height: wysokosc === null ? null : Math.round(wysokosc),
    }
  } catch {
    // Brak ffprobe odbiera tylko suwak, nie samą możliwość montażu.
    return puste
  }
}

/** Postęp z linii `frame= … time=00:00:12.34 …` na stderr. */
export function parseTimeMs(chunk: string): number | null {
  const matches = [...chunk.matchAll(/time=(\d+):(\d{2}):(\d{2})\.(\d{1,3})/g)]
  const last = matches.at(-1)
  if (last === undefined) return null

  const hours = Number(last[1])
  const minutes = Number(last[2])
  const seconds = Number(last[3])
  const fraction = Number(`0.${last[4] ?? '0'}`)

  if (![hours, minutes, seconds].every(Number.isFinite)) return null

  return Math.round(((hours * 60 + minutes) * 60 + seconds + fraction) * 1000)
}

/**
 * Uruchamia FFmpeg i raportuje postęp. `durationMs` może być `null` —
 * wtedy pokazujemy fazę bez procentu zamiast zmyślać liczbę.
 */
async function runFfmpeg(
  args: readonly string[],
  ctx: JobContext,
  options: { durationMs: number | null; phase: string; percentFrom: number; percentTo: number },
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(env.FFMPEG_PATH, [...args], { shell: false })

    let stderrTail = ''
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
      stderrTail = `${stderrTail}${chunk}`.slice(-4000)

      const timeMs = parseTimeMs(chunk)
      const span = options.percentTo - options.percentFrom

      if (timeMs === null || options.durationMs === null || options.durationMs === 0) {
        ctx.onProgress({ percent: options.percentFrom, phase: options.phase })
        return
      }

      const ratio = Math.min(timeMs / options.durationMs, 1)
      ctx.onProgress({
        percent: options.percentFrom + span * ratio,
        phase: options.phase,
      })
    })

    child.on('error', (error) => {
      finish(() =>
        rejectPromise(new JobError('FFMPEG_FAILED', 'nie udało się uruchomić FFmpeg', { cause: error })),
      )
    })

    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolvePromise()
          return
        }
        ctx.logger.error('FFmpeg zakończył się błędem', {
          code: code ?? -1,
          tail: stderrTail.slice(-500),
        })
        rejectPromise(new JobError('FFMPEG_FAILED', `FFmpeg zwrócił kod ${code}`))
      })
    })
  })
}

/** Buduje łańcuch filtrów z operacji wybranych przez grafika. */
export function buildFilterChain(operations: readonly VideoOperation[]): string | null {
  const filters: string[] = []

  for (const operation of operations) {
    if (operation.kind === 'crop') {
      filters.push(CROP_EXPRESSIONS[operation.aspect])
    }
  }

  const pingPong = operations.some(
    (operation) => operation.kind === 'loop' && operation.pingPong,
  )

  if (pingPong) {
    // Odtworzenie w przód i wstecz. `split` dubluje strumień, `reverse`
    // odwraca kopię, `concat` skleja je w jedną całość.
    const prefix = filters.length > 0 ? `${filters.join(',')},` : ''
    return `${prefix}split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1`
  }

  return filters.length > 0 ? filters.join(',') : null
}

export interface RenderRequest {
  sourcePath: string
  outputPath: string
  operations: readonly VideoOperation[]
  /** Docelowa waga pliku w bajtach. Przelicza się na bitrate. */
  targetBytes: number
  codec: 'h264' | 'av1'
}

export async function render(
  request: RenderRequest,
  ctx: JobContext,
  progress: { from: number; to: number },
): Promise<{ kodek: string }> {
  let uzytyKodek = 'libx264'
  const sourceDuration = await probeDurationMs(request.sourcePath)
  const trim = request.operations.find(
    (operation): operation is TrimOperation => operation.kind === 'trim',
  )

  let effectiveDuration = trim === undefined ? sourceDuration : trim.endMs - trim.startMs
  if (effectiveDuration !== null && request.operations.some((o) => o.kind === 'loop')) {
    effectiveDuration *= 2
  }

  const args: string[] = ['-y', '-hide_banner']

  if (trim !== undefined) {
    args.push('-ss', String(trim.startMs / 1000), '-to', String(trim.endMs / 1000))
  }

  args.push('-i', request.sourcePath)

  const filterChain = buildFilterChain(request.operations)
  if (filterChain !== null) {
    args.push('-filter_complex', filterChain)
  }

  // Bitrate liczony z docelowej wagi. Zapas 10% zostawiamy na kontener
  // i ścieżkę dźwiękową, żeby plik nie przekroczył limitu o włos.
  const seconds = effectiveDuration === null ? 10 : effectiveDuration / 1000
  const bitrate = Math.max(Math.floor((request.targetBytes * 8 * 0.9) / seconds), 100_000)

  if (request.codec === 'h264') {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p')
  } else {
    const kodek = await wybierzKodek()
    uzytyKodek = kodek.nazwa
    args.push('-c:v', kodek.nazwa, ...kodek.opcje, '-pix_fmt', 'yuv420p')
  }

  /*
   * Sufit VBV, nie samo `-b:v`.
   *
   * `-b:v` jest **celem średnim**: koder wolno przekracza go na trudnych
   * fragmentach i nadrabia na łatwych. Przy krótkiej pętli z ruchem nie ma
   * czym nadrobić, więc plik wychodził ponad zadaną wagę. `-maxrate` z
   * `-bufsize` zamieniają cel w twardą granicę chwilową.
   *
   * `bufsize` równy dwukrotności bitrate'u to standardowy kompromis: mniejszy
   * dławi jakość na cięciach, większy przestaje być sufitem.
   */
  args.push('-b:v', String(bitrate))

  /*
   * Sufit VBV — **wyłącznie dla H.264**.
   *
   * `-b:v` jest celem średnim: koder wolno przekracza go na trudnych
   * fragmentach i nadrabia na łatwych. Przy krótkiej pętli z ruchem nie ma
   * czym nadrobić, więc plik wychodził ponad zadaną wagę. `-maxrate`
   * z `-bufsize` zamieniają cel w twardą granicę chwilową.
   *
   * Przy `libsvtav1` te same argumenty **wywracają kodowanie**: sprawdzone na
   * żywym montażu, `Could not open encoder before EOF` i kod -22. SVT-AV1 ma
   * własny tryb sterowania przepływnością i nie przyjmuje tej pary obok
   * `-b:v`. Zostawiamy mu sam cel średni.
   */
  if (request.codec === 'h264') {
    args.push('-maxrate', String(bitrate), '-bufsize', String(bitrate * 2))
  }

  args.push('-an', request.outputPath)

  await runFfmpeg(args, ctx, {
    durationMs: effectiveDuration,
    phase: request.codec === 'h264' ? 'Składam plik MP4' : 'Składam plik WebM',
    percentFrom: progress.from,
    percentTo: progress.to,
  })

  return { kodek: uzytyKodek }
}

/** Pierwsza klatka jako JPG — plansza pokazywana, zanim ruszy film. */
export async function extractPoster(
  sourcePath: string,
  outputPath: string,
  ctx: JobContext,
): Promise<void> {
  await runFfmpeg(
    ['-y', '-hide_banner', '-i', sourcePath, '-frames:v', '1', '-q:v', '3', outputPath],
    ctx,
    { durationMs: null, phase: 'Zapisuję planszę', percentFrom: 0.9, percentTo: 0.95 },
  )
}

/**
 * Pierwsza klatka klipu jako miniatura do siatki galerii.
 *
 * Osobno od `extractPoster`, bo nie potrzebuje `JobContext` — miniatura
 * powstaje na żądanie z trasy plików, poza kolejką zadań.
 *
 * Bez tego kafelek wideo był elementem `<video preload="metadata">`, a to
 * po dodaniu obsługi `Range` okazało się **gorsze niż przed zmianą**:
 * przeglądarka wysyłała 29 żądań częściowych i ściągała 228 MB przy galerii
 * ważącej 46 MB. Zmierzone. Obrazek nie ma tego problemu.
 */
export async function klatkaDoMiniatury(zrodlo: string, cel: string): Promise<boolean> {
  try {
    const wynik = await runBinary(
      env.FFMPEG_PATH,
      [
        '-y',
        '-hide_banner',
        '-v',
        'error',
        // Klatka z pierwszej sekundy, nie z zerowej — początek bywa czarny.
        '-ss',
        '1',
        '-i',
        zrodlo,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-q:v',
        '4',
        cel,
      ],
      { timeoutMs: 20_000 },
    )

    return wynik.code === 0
  } catch {
    return false
  }
}
