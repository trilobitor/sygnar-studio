import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/server/db/client'
import { jobs, type Job } from '@/server/db/schema'
import type { JobErrorCode } from '@/server/adapters/types'

/**
 * Stan kolejki trzymany w tabeli `jobs` (SPEC §9) — restart serwera
 * nie gubi kolejki, bo pamięć procesu nie jest tu źródłem prawdy.
 */

export type JobKind = Job['kind']
export type JobStatus = Job['status']

/** Zadania GPU idą pojedynczo; reszta może biec równolegle (SPEC §9). */
export const GPU_JOB_KINDS: readonly JobKind[] = ['image_generate', 'video_render']

export function isGpuJob(kind: JobKind): boolean {
  return GPU_JOB_KINDS.includes(kind)
}

export interface EnqueueInput {
  orderId: string
  kind: JobKind
  params: unknown
}

export function enqueue(input: EnqueueInput): Job {
  const now = Date.now()
  const row = {
    id: randomUUID(),
    orderId: input.orderId,
    kind: input.kind,
    status: 'queued' as const,
    paramsJson: JSON.stringify(input.params),
    progress: 0,
    phase: 'W kolejce',
    errorCode: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  }

  db.insert(jobs).values(row).run()
  return row
}

export function getJob(id: string): Job | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()
}

export function listJobs(limit = 50): Job[] {
  return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all()
}

export function listJobsForOrder(orderId: string, limit = 50): Job[] {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.orderId, orderId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .all()
}

/** Zadania czekające, najstarsze pierwsze — kolejność jest FIFO. */
export function listQueued(): Job[] {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .orderBy(asc(jobs.createdAt))
    .all()
}

export function countRunning(kinds: readonly JobKind[]): number {
  const running = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), inArray(jobs.kind, [...kinds])))
    .all()
  return running.length
}

/** Ile zadań czeka przed tym konkretnym. Zasila komunikat „1 zadanie przed Tobą". */
export function positionInQueue(job: Job): number {
  return listQueued().filter((candidate) => candidate.createdAt < job.createdAt).length
}

export function markRunning(id: string): void {
  db.update(jobs)
    .set({ status: 'running', startedAt: Date.now(), phase: 'Przygotowuję', progress: 0 })
    .where(eq(jobs.id, id))
    .run()
}

export function updateProgress(id: string, percent: number, phase: string): void {
  db.update(jobs)
    .set({ progress: Math.max(0, Math.min(percent, 1)), phase })
    .where(eq(jobs.id, id))
    .run()
}

export function markDone(id: string): void {
  db.update(jobs)
    .set({ status: 'done', progress: 1, phase: 'Gotowe', finishedAt: Date.now() })
    .where(eq(jobs.id, id))
    .run()
}

export function markFailed(id: string, errorCode: JobErrorCode): void {
  db.update(jobs)
    .set({ status: 'failed', errorCode, phase: null, finishedAt: Date.now() })
    .where(eq(jobs.id, id))
    .run()
}

/** Zwraca `true`, gdy któryś wiersz faktycznie zmienił stan. */
export function markCancelled(id: string): boolean {
  const wynik = db
    .update(jobs)
    .set({
      status: 'cancelled',
      errorCode: 'JOB_CANCELLED',
      phase: null,
      finishedAt: Date.now(),
    })
    .where(eq(jobs.id, id))
    .run()

  return wynik.changes > 0
}

/**
 * Zadania zastane w stanie `running` przy starcie serwera nie mają procesu,
 * który by je dokończył — proces zginął razem z poprzednim uruchomieniem.
 */
export function failInterruptedJobs(): number {
  const stuck = db.select().from(jobs).where(eq(jobs.status, 'running')).all()

  for (const job of stuck) {
    markFailed(job.id, 'INTERRUPTED_BY_RESTART')
  }

  return stuck.length
}
