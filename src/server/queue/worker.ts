import { mkdir, rmdir } from 'node:fs/promises'

import { env } from '@/lib/env'
import { createLogger, logger } from '@/lib/logger'
import { JobError, type JobContext, type JobErrorCode } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { jobWorkDir } from '@/server/services/paths'
import { publish } from './events'
import { keepAwake, zwolnijBlokade } from './keep-awake'
import {
  countRunning,
  failInterruptedJobs,
  GPU_JOB_KINDS,
  isGpuJob,
  isVideoJob,
  VIDEO_JOB_KINDS,
  listJobs,
  listQueued,
  markCancelled,
  markDone,
  markFailed,
  markRunning,
  updateProgress,
  type JobKind,
} from './store'

/**
 * Worker kolejki (SPEC §9).
 *
 * Jedno zadanie GPU naraz — to nie jest kosmetyka. Zmierzony w E0 szczyt
 * pamięci przy kadrze 2,08 Mpx to 27,81 GB przy 32 GB w maszynie; dwa
 * równoległe zadania GPU wyczerpią pamięć.
 *
 * Zadania nie-GPU (eksport, poster) mają osobną pulę i mogą biec równolegle.
 */

/** Ile zadań nie-GPU może biec naraz. Ograniczone rdzeniami, nie pamięcią. */
const NON_GPU_CONCURRENCY = 2

const NON_GPU_JOB_KINDS: readonly JobKind[] = ['image_export', 'photo_batch']

/** Twardy timeout per rodzaj zadania (SPEC §9). */
/** Każdy rodzaj zadania ma własny, konfigurowalny limit czasu. */
const TIMEOUTS_MS: Record<JobKind, number> = {
  image_generate: env.JOB_TIMEOUT_MS,
  video_render: env.VIDEO_TIMEOUT_MS,
  image_export: env.EXPORT_TIMEOUT_MS,
  photo_batch: env.PHOTO_BATCH_TIMEOUT_MS,
}

/** Funkcja wykonawcza zadania danego rodzaju. Rejestrowana przez serwisy. */
export type JobRunner = (job: Job, ctx: JobContext) => Promise<void>

const globalForWorker = globalThis as unknown as {
  studioRunners?: Map<JobKind, JobRunner>
  studioAborts?: Map<string, AbortController>
  studioTicking?: boolean
  studioStarted?: boolean
}

const runners: Map<JobKind, JobRunner> = globalForWorker.studioRunners ?? new Map()
globalForWorker.studioRunners = runners

const aborts: Map<string, AbortController> = globalForWorker.studioAborts ?? new Map()

/**
 * Obietnice biegnących zadań, żeby dało się na nie **poczekać**.
 *
 * Samo `cancelJob` tylko sygnalizuje przerwanie — proces mfluxa albo ffmpega
 * kończy się chwilę później. Kasowanie zlecenia zaraz po anulowaniu usuwało
 * katalog spod działającego procesu; ten dopisywał do niego plik już po
 * usunięciu i zostawiał osierocone drzewo.
 */
const biegnace = new Map<string, Promise<void>>()

/** Czeka, aż zadania tego zlecenia faktycznie się zatrzymają. */
export async function poczekajNaZatrzymanie(jobIds: readonly string[], msMax = 10_000): Promise<void> {
  const obietnice = jobIds.map((id) => biegnace.get(id)).filter((p) => p !== undefined)

  if (obietnice.length === 0) return

  // Limit czasu, żeby zawieszony proces nie blokował kasowania na zawsze —
  // lepiej zostawić katalog do sprzątnięcia niż zablokować panel.
  await Promise.race([
    Promise.allSettled(obietnice),
    new Promise((r) => setTimeout(r, msMax)),
  ])
}
globalForWorker.studioAborts = aborts

export function registerRunner(kind: JobKind, runner: JobRunner): void {
  runners.set(kind, runner)
}

/** Rozgłasza aktualny stan kolejki wszystkim podłączonym klientom. */
function broadcast(): void {
  publish({ jobs: listJobs(20), at: Date.now() })
}

/**
 * Anulowanie zadania. Zadanie czekające gaśnie od razu, biegnące dostaje
 * sygnał przez `AbortController` przekazany do adaptera.
 */
/**
 * Anuluje zadanie. Zwraca `true`, gdy było co anulować.
 *
 * Wcześniej zwracała `true` **zawsze**, także dla identyfikatora, którego nie
 * ma w bazie — czyli wartość nie niosła żadnej informacji. Trasa `DELETE` tego
 * nie zauważyła, bo sprawdza istnienie zadania wcześniej, ale kontrakt kłamał.
 */
export function cancelJob(id: string): boolean {
  const controller = aborts.get(id)

  if (controller !== undefined) {
    controller.abort()
    return true
  }

  // Zadanie czeka w kolejce albo nie istnieje — `markCancelled` mówi które.
  const zmienione = markCancelled(id)
  if (zmienione) broadcast()

  return zmienione
}

/** Ile montaży naraz. Jeden — patrz komentarz przy `VIDEO_JOB_KINDS`. */
const VIDEO_CONCURRENCY = 1

function hasFreeSlot(kind: JobKind): boolean {
  if (isGpuJob(kind)) {
    return countRunning(GPU_JOB_KINDS) < env.MAX_CONCURRENT_GPU_JOBS
  }

  // Montaż ma własną pulę: nie blokuje generowania, ale i nie zwielokrotnia
  // się sam, bo filtr `reverse` trzyma cały materiał w pamięci.
  if (isVideoJob(kind)) {
    return countRunning(VIDEO_JOB_KINDS) < VIDEO_CONCURRENCY
  }

  return countRunning(NON_GPU_JOB_KINDS) < NON_GPU_CONCURRENCY
}

/** Kody systemu plików, przy których winny jest dysk, nie ustawienia. */
const KODY_DYSKU = new Set(['ENOSPC', 'EACCES', 'EROFS', 'EDQUOT', 'EPERM'])

function errorCodeFor(error: unknown): JobErrorCode {
  if (error instanceof JobError) return error.code

  /*
   * Pełny dysk wyglądał jak „coś jest nie tak z ustawieniami generowania".
   *
   * Domyślny kod `COMFY_WORKFLOW_INVALID` mapuje się na komunikat o błędzie
   * po naszej stronie w konfiguracji modelu — grafik szukałby więc czegoś,
   * czego nie da się poprawić, zamiast zwolnić miejsce albo zawołać kogoś
   * do maszyny.
   */
  const kod: unknown = error === null || typeof error !== 'object' ? null : Reflect.get(error, 'code')
  if (typeof kod === 'string' && KODY_DYSKU.has(kod)) return 'DISK_FULL'

  return 'COMFY_WORKFLOW_INVALID'
}

async function runJob(job: Job): Promise<void> {
  const runner = runners.get(job.kind)
  const jobLogger = createLogger({ jobId: job.id, orderId: job.orderId, kind: job.kind })

  if (runner === undefined) {
    jobLogger.error('brak funkcji wykonawczej dla rodzaju zadania')
    markFailed(job.id, 'COMFY_WORKFLOW_INVALID')
    broadcast()
    return
  }

  const controller = new AbortController()
  aborts.set(job.id, controller)

  const timeout = setTimeout(() => {
    controller.abort(new JobError('JOB_TIMEOUT', 'przekroczono czas zadania'))
  }, TIMEOUTS_MS[job.kind])

  const workDir = jobWorkDir(env.STUDIO_DATA_DIR, job.orderId, job.id)

  // Zadania GPU trwają minuty — maszyna nie może w tym czasie zasnąć.
  const releaseWakeLock = isGpuJob(job.kind) ? keepAwake() : () => {}

  markRunning(job.id)
  broadcast()

  // Postęp zapisujemy nie częściej niż co sekundę — zapis do bazy przy każdej
  // linii z paska postępu obciążałby dysk bez pożytku dla oglądającego.
  let lastWrite = 0

  const ctx: JobContext = {
    signal: controller.signal,
    workDir,
    logger: jobLogger,
    onProgress: (progress) => {
      const now = Date.now()
      if (now - lastWrite < 1000 && progress.percent < 1) return
      lastWrite = now
      updateProgress(job.id, progress.percent, progress.phase)
      broadcast()
    },
  }

  /**
   * Zamknięcie zadania przerwanego z zewnątrz.
   *
   * Jedna funkcja dla obu ścieżek — powrotu runnera i wyjątku — bo rozdzielone
   * rozjeżdżały się przy każdej zmianie. Runner, który **nie sprawdza sygnału**
   * (jak eksport przez sharpa), wraca normalnie mimo anulowania i bez tego
   * zadanie kończyło się statusem „Gotowe", choć nikt na niego nie czekał.
   */
  function zamknijPrzerwane(): void {
    const powod: unknown = controller.signal.reason

    if (powod instanceof JobError && powod.code === 'JOB_TIMEOUT') {
      markFailed(job.id, 'JOB_TIMEOUT')
      jobLogger.warn('zadanie przerwane po przekroczeniu czasu')
      return
    }

    markCancelled(job.id)
    jobLogger.info('zadanie anulowane')
  }

  try {
    await mkdir(workDir, { recursive: true })
    await runner(job, ctx)

    // Runner mógł zakończyć się normalnie mimo anulowania — nie każdy adapter
    // pilnuje sygnału. O statusie decyduje sygnał, nie sposób powrotu.
    if (controller.signal.aborted) {
      zamknijPrzerwane()
    } else {
      markDone(job.id)
      jobLogger.info('zadanie zakończone')
    }
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof JobError && error.code === 'JOB_TIMEOUT')) {
      zamknijPrzerwane()
    } else {
      const code = errorCodeFor(error)
      markFailed(job.id, code)
      jobLogger.error('zadanie nieudane', {
        code,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    clearTimeout(timeout)
    releaseWakeLock()
    aborts.delete(job.id)
    biegnace.delete(job.id)

    // Montaż i eksport zapisują wynik poza katalogiem roboczym, więc zostaje
    // po nich pusty folder na każde zadanie. `rmdir` sam odmówi, gdy coś
    // w środku jest — a przy generowaniu jest, bo tam leżą gotowe kadry.
    await rmdir(workDir).catch(() => {})

    broadcast()
    // Zwolniony slot może od razu przyjąć następne zadanie.
    void tick()
  }
}

/** Bierze z kolejki, co się da, i puszcza w tło. Nie czeka na zakończenie. */
export async function tick(): Promise<void> {
  /*
   * Wartownik był bezużyteczny: pętla poniżej puszcza zadania **bez `await`**,
   * więc `tick()` kończy się natychmiast i flaga wraca do `false`, zanim
   * którekolwiek zadanie zdąży ruszyć. Dwa wywołania w tej samej chwili
   * przechodziły więc oba.
   *
   * Teraz flaga chroni to, co faktycznie jest krytyczne — odczyt kolejki
   * i decyzję o przydziale slotu. Same zadania nadal biegną w tle.
   */
  if (globalForWorker.studioTicking === true) return
  globalForWorker.studioTicking = true

  try {
    for (const job of listQueued()) {
      if (!hasFreeSlot(job.kind)) continue
      // Świadomie bez `await` — zadanie ma biec w tle, a pętla ma iść dalej.
      // Obietnicę zapamiętujemy, żeby kasowanie zlecenia mogło na nią zaczekać.
      const obietnica = runJob(job)
      biegnace.set(job.id, obietnica)
      void obietnica
    }
  } finally {
    globalForWorker.studioTicking = false
  }
}

/**
 * Uruchomienie workera przy starcie serwera. Zadania zastane w stanie
 * `running` nie mają procesu, który by je dokończył — proces zginął razem
 * z poprzednim uruchomieniem, więc oznaczamy je jako przerwane.
 */
export function startWorker(): void {
  if (globalForWorker.studioStarted === true) return
  globalForWorker.studioStarted = true

  // Osierocone dzieci po ubiciu serwera to wyciek, który narasta z każdym
  // restartem usługi — patrz `armujSprzatanie`.
  armujSprzatanie()

  const interrupted = failInterruptedJobs()
  if (interrupted > 0) {
    logger.warn('oznaczono zadania przerwane restartem', { count: interrupted })
  }

  void tick()
}

/**
 * Sprzątanie przy wyjściu procesu.
 *
 * Bez tego ubicie serwera zostawiało osierocone dzieci: mflux albo ffmpeg
 * mieliły dalej, trzymając pamięć i pisząc do katalogu, którego nikt już nie
 * pilnuje, a `caffeinate` nie pozwalał maszynie zasnąć. Przy usłudze
 * `launchd`, która restartuje panel, narastało to z każdym restartem.
 *
 * Rejestrujemy raz na proces — `once` na fladze w `globalThis`, bo Next
 * przeładowuje moduły i bez tego handlerów przybywałoby przy każdej zmianie.
 */
const globalForShutdown = globalThis as unknown as { studioShutdownArmed?: boolean }

export function armujSprzatanie(): void {
  if (globalForShutdown.studioShutdownArmed === true) return
  globalForShutdown.studioShutdownArmed = true

  const sprzataj = (sygnal: string): void => {
    logger.info('zatrzymywanie panelu', { sygnal, biegnacych: aborts.size })

    for (const controller of aborts.values()) {
      controller.abort(new JobError('INTERRUPTED_BY_RESTART', 'panel się zatrzymuje'))
    }

    zwolnijBlokade()
  }

  for (const sygnal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sygnal, () => {
      sprzataj(sygnal)
      // Dajemy chwilę na dojście sygnału do dzieci, potem wychodzimy.
      setTimeout(() => process.exit(0), 300)
    })
  }

  process.once('beforeExit', () => {
    zwolnijBlokade()
  })
}
