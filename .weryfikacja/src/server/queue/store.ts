import { randomUUID } from 'node:crypto'

import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'

import { ApiError } from '@/server/adapters/types'
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
/**
 * Zadania korzystające z GPU. **Bez montażu.**
 *
 * `video_render` siedział tu wcześniej, przez co montaż blokował generowanie
 * i odwrotnie — bez powodu technicznego, bo ffmpeg liczy na procesorze
 * (`libx264`, `libsvtav1`). Sprawdzone: `h264_videotoolbox` jest na tej
 * maszynie **wolniejszy** (1,71 s wobec 1,18 s na klipie 10 s) i nie trzyma
 * zadanej przepływności — plik wyszedł trzykrotnie lżejszy od zamówionego.
 * Nie ma więc powodu, żeby montaż w ogóle dotykał GPU.
 */
/*
 * Poprawka kadru zajmuje GPU tak samo jak generowanie — zmierzone 17,50 GB
 * szczytu przy kadrze 1024 × 1344 wobec 27,81 GB przy generowaniu 2,08 Mpx.
 * Mniej, ale nie na tyle, żeby puścić oba naraz na maszynie z 32 GB.
 */
export const GPU_JOB_KINDS: readonly JobKind[] = ['image_generate', 'image_edit']

/**
 * Montaż ma własną pulę o rozmiarze jeden.
 *
 * Nie przez GPU, tylko przez pamięć: filtr `reverse` trzyma cały odwracany
 * materiał w RAM — zmierzone 1,99 GB na 20 s w 1080p. Dwa montaże naraz obok
 * generowania (17,95 GB) byłyby zbyt blisko 32 GB maszyny.
 */
export const VIDEO_JOB_KINDS: readonly JobKind[] = ['video_render']

export function isVideoJob(kind: JobKind): boolean {
  return VIDEO_JOB_KINDS.includes(kind)
}

export function isGpuJob(kind: JobKind): boolean {
  return GPU_JOB_KINDS.includes(kind)
}

export interface EnqueueInput {
  orderId: string
  kind: JobKind
  params: unknown
}

/**
 * Sufit długości kolejki.
 *
 * Kod `QUEUE_BUSY` i gotowy komunikat („Stacja liczy inne zadanie. Twoje
 * ruszy, gdy tamto się skończy.") istniały od początku i **nikt ich nie
 * rzucał** — kolejka przyjmowała dowolnie wiele zadań. Grafik mógł zamówić
 * pięćdziesiąt generowań i czekać dwie godziny, nie wiedząc, że sam to sobie
 * zrobił.
 *
 * Dwadzieścia to około godziny pracy stacji przy czterech wariantach —
 * więcej i tak nie zdąży obejrzeć.
 */
const MAX_W_KOLEJCE = 20

export function enqueue(input: EnqueueInput): Job {
  // Sufit kolejki. Kod `QUEUE_BUSY` istniał od początku i nikt go nie rzucał.
  const czeka = db
    .select({ ile: count() })
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .get()

  if ((czeka?.ile ?? 0) >= MAX_W_KOLEJCE) {
    throw new ApiError('QUEUE_BUSY', 'w kolejce czeka już maksymalna liczba zadań', 429)
  }

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

/**
 * Ile zadań danego rodzaju biegnie. Liczone w bazie, nie w pamięci.
 *
 * Wcześniej pobieraliśmy **wszystkie** pasujące wiersze i mierzyli długość
 * tablicy. Przy kilku zadaniach to bez znaczenia, ale funkcja jest wołana
 * przy każdym `tick()`, czyli po każdym zakończonym zadaniu i przy każdym
 * nowym — a wiersze niosą `params_json`, który bywa kilobajtowy.
 */
export function countRunning(kinds: readonly JobKind[]): number {
  const wynik = db
    .select({ ile: count() })
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), inArray(jobs.kind, [...kinds])))
    .get()

  return wynik?.ile ?? 0
}

/** Ile zadań czeka przed tym konkretnym. Zasila komunikat „1 zadanie przed Tobą". */
/** Rodzaje zadań korzystających z GPU. Mają własną, jednomiejscową pulę. */
const GPU_KINDS = new Set(['image_generate'])

/**
 * Ile zadań czeka przed tym konkretnym — **w jego własnej puli**.
 *
 * Zadania GPU i pozostałe stoją w osobnych kolejkach: generowanie przepuszcza
 * jedno naraz, reszta dwa. Liczenie ich razem dawało liczbę bez związku
 * z rzeczywistym czasem oczekiwania — eksport potrafił „mieć przed sobą"
 * generowanie, na które w ogóle nie czekał.
 */
export function positionInQueue(job: Job): number {
  const taSamaPula = (kind: string): boolean => GPU_KINDS.has(kind) === GPU_KINDS.has(job.kind)

  return listQueued().filter(
    (candidate) => taSamaPula(candidate.kind) && candidate.createdAt < job.createdAt,
  ).length
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
