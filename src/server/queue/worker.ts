import { mkdir } from 'node:fs/promises'

import { env } from '@/lib/env'
import { createLogger, logger } from '@/lib/logger'
import { JobError, type JobContext, type JobErrorCode } from '@/server/adapters/types'
import type { Job } from '@/server/db/schema'
import { publish } from './events'
import { keepAwake } from './keep-awake'
import {
  countRunning,
  failInterruptedJobs,
  GPU_JOB_KINDS,
  isGpuJob,
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
const TIMEOUTS_MS: Record<JobKind, number> = {
  image_generate: env.JOB_TIMEOUT_MS,
  video_render: env.JOB_TIMEOUT_MS,
  image_export: 120_000,
  photo_batch: 600_000,
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
export function cancelJob(id: string): boolean {
  const controller = aborts.get(id)

  if (controller !== undefined) {
    controller.abort()
    return true
  }

  markCancelled(id)
  broadcast()
  return true
}

function hasFreeSlot(kind: JobKind): boolean {
  if (isGpuJob(kind)) {
    return countRunning(GPU_JOB_KINDS) < env.MAX_CONCURRENT_GPU_JOBS
  }
  return countRunning(NON_GPU_JOB_KINDS) < NON_GPU_CONCURRENCY
}

function errorCodeFor(error: unknown): JobErrorCode {
  if (error instanceof JobError) return error.code
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

  const workDir = `${env.STUDIO_DATA_DIR}/orders/${job.orderId}/generated`

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

  try {
    await mkdir(workDir, { recursive: true })
    await runner(job, ctx)
    markDone(job.id)
    jobLogger.info('zadanie zakończone')
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof JobError && error.code === 'JOB_TIMEOUT')) {
      const reason: unknown = controller.signal.reason
      if (reason instanceof JobError && reason.code === 'JOB_TIMEOUT') {
        markFailed(job.id, 'JOB_TIMEOUT')
        jobLogger.warn('zadanie przerwane po przekroczeniu czasu')
      } else {
        markCancelled(job.id)
        jobLogger.info('zadanie anulowane')
      }
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
    broadcast()
    // Zwolniony slot może od razu przyjąć następne zadanie.
    void tick()
  }
}

/** Bierze z kolejki, co się da, i puszcza w tło. Nie czeka na zakończenie. */
export async function tick(): Promise<void> {
  if (globalForWorker.studioTicking === true) return
  globalForWorker.studioTicking = true

  try {
    for (const job of listQueued()) {
      if (!hasFreeSlot(job.kind)) continue
      // Świadomie bez `await` — zadanie ma biec w tle, a pętla ma iść dalej.
      void runJob(job)
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

  const interrupted = failInterruptedJobs()
  if (interrupted > 0) {
    logger.warn('oznaczono zadania przerwane restartem', { count: interrupted })
  }

  void tick()
}
