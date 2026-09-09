import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'

import { and, count, desc, eq, inArray, isNotNull, sql, sum } from 'drizzle-orm'

import { env } from '@/lib/env'
import { briefSchema, type Brief, type CreateOrderInput } from '@/lib/schemas'
import { ApiError } from '@/server/adapters/types'
import { db } from '@/server/db/client'
import {
  assets,
  briefs,
  jobs,
  orders,
  promptRuns,
  type Asset,
  type Order,
} from '@/server/db/schema'
import { bucketDir, orderDir } from './paths'

/**
 * Zlecenia — byt spinający całą pracę (SPEC §2).
 * Warstwa serwisów nie importuje niczego z `next/*`.
 */

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const now = Date.now()
  const row: Order = {
    id: randomUUID(),
    name: input.name,
    industry: input.industry ?? null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }

  db.insert(orders).values(row).run()

  // Katalogi powstają razem ze zleceniem, żeby brak uprawnień do zapisu
  // ujawnił się teraz, a nie w połowie zadania trwającego trzy minuty.
  for (const bucket of ['generated', 'uploads', 'exports'] as const) {
    await mkdir(bucketDir(env.STUDIO_DATA_DIR, row.id, bucket), { recursive: true })
  }

  return row
}

export function listOrders(limit = 50): Order[] {
  return db.select().from(orders).orderBy(desc(orders.updatedAt)).limit(limit).all()
}

export function getOrder(id: string): Order {
  const row = db.select().from(orders).where(eq(orders.id, id)).get()
  if (row === undefined) {
    throw new ApiError('NOT_FOUND', 'nie ma takiego zlecenia', 404)
  }
  return row
}

export function listAssets(orderId: string): Asset[] {
  return db
    .select()
    .from(assets)
    .where(eq(assets.orderId, orderId))
    .orderBy(desc(assets.createdAt))
    .all()
}

/** Zmiana nazwy. Branża zostaje — jest członem nazw plików już oddanych. */
/**
 * Zmiana nazwy, opcjonalnie także branży.
 *
 * Branży wcześniej nie dało się zmienić — komentarz przy schemacie twierdził,
 * że „siedzi w nazwach plików". Nazwy powstają jednak przy eksporcie, a nie
 * przy zakładaniu zlecenia, więc pomyłka oznaczała konieczność założenia go
 * od nowa. Pliki już oddane zachowują swoje nazwy; zmiana dotyczy kolejnych.
 */
export function renameOrder(id: string, name: string, industry?: Order['industry']): Order {
  getOrder(id)

  db.update(orders)
    .set({
      name,
      ...(industry === undefined ? {} : { industry }),
      updatedAt: Date.now(),
    })
    .where(eq(orders.id, id))
    .run()

  return getOrder(id)
}

/**
 * Usunięcie zlecenia razem z wszystkim, co do niego należy.
 *
 * Wiersze w `briefs`, `jobs`, `assets` i `prompt_runs` znikają kaskadą
 * (klucze obce z `ON DELETE CASCADE` przy włączonym `PRAGMA foreign_keys`).
 * Pliki na dysku trzeba skasować osobno — baza o nich nie wie nic poza
 * ścieżką względną.
 *
 * Operacja jest nieodwracalna, więc interfejs pyta o potwierdzenie.
 */
export async function deleteOrder(id: string): Promise<void> {
  const order = getOrder(id)

  // Katalog składamy z `STUDIO_DATA_DIR` i identyfikatora z bazy, nigdy
  // z danych od klienta — `orderDir` odrzuci fragment ze ścieżką (SPEC §13).
  const directory = orderDir(env.STUDIO_DATA_DIR, order.id)

  db.delete(orders).where(eq(orders.id, order.id)).run()

  // Kasujemy dopiero po usunięciu wiersza: gdyby kasowanie plików padło,
  // zostanie osierocony katalog, a nie wpis wskazujący na nieistniejące pliki.
  await rm(directory, { recursive: true, force: true })
}

export function touchOrder(id: string, status?: Order['status']): void {
  db.update(orders)
    .set(status === undefined ? { updatedAt: Date.now() } : { updatedAt: Date.now(), status })
    .where(eq(orders.id, id))
    .run()
}

export function saveBrief(orderId: string, payload: unknown): string {
  const id = randomUUID()
  db.insert(briefs)
    .values({
      id,
      orderId,
      payloadJson: JSON.stringify(payload),
      createdAt: Date.now(),
    })
    .run()
  return id
}

export function latestBrief(orderId: string): Brief | null {
  const row = db
    .select()
    .from(briefs)
    .where(eq(briefs.orderId, orderId))
    .orderBy(desc(briefs.createdAt))
    .limit(1)
    .get()

  if (row === undefined) return null

  // W bazie leżą wartości już zwalidowane tym schematem, więc `safeParse`
  // chroni wyłącznie przed briefami zapisanymi wcześniejszą wersją makiety.
  // Brief, którego nie da się odczytać, jest tym samym co jego brak —
  // lepiej pusty formularz niż wysypana strona.
  const parsed = briefSchema.safeParse(JSON.parse(row.payloadJson))
  return parsed.success ? parsed.data : null
}

/**
 * Historia opisów przygotowanych dla zlecenia.
 *
 * `prompt_runs` była tabelą tylko do zapisu — rygor C wymagał zapisu każdego
 * wywołania modelu razem z kosztem, ale nikt tych wierszy nie czytał. Zapis,
 * którego nikt nie ogląda, nie jest kontrolą, tylko kosztem.
 */
export function listPromptRuns(
  orderId: string,
  limit = 20,
): { id: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; promptEn: string; createdAt: number }[] {
  return db
    .select()
    .from(promptRuns)
    .where(eq(promptRuns.orderId, orderId))
    .orderBy(desc(promptRuns.createdAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd,
      promptEn: row.promptEn,
      createdAt: row.createdAt,
    }))
}

/** Liczby do wyceny zlecenia. */
export interface OrderSummary {
  /** Ile kadrów policzył generator. */
  frames: number
  /** Ile plików grafik przygotował do oddania klientowi. */
  delivered: number
  /** Łączny czas zadań liczących: generowanie i montaż, w milisekundach. */
  stationMs: number
  /**
   * Suma przeliczników zużycia warstwy promptowej.
   *
   * To **nie** jest kwota do zapłacenia (D14): przy subskrypcji Claude Code
   * nic z tego nie idzie na fakturę. To miara, ile zlecenie kosztowało pracy
   * modelu — przydatna przy porównywaniu zleceń między sobą.
   */
  promptUsd: number
  /** Ile razy warstwa promptowa liczyła opis. */
  promptRuns: number
}

/**
 * Jedno zapytanie agregujące zamiast wyciągania wszystkich wierszy.
 *
 * Tabela `prompt_runs` zapisywała model, tokeny i koszt każdego wywołania
 * i nikt jej nigdy nie czytał; czas pracy stacji leżał w `started_at`
 * i `finished_at` każdego zadania i też nie był nigdzie pokazywany.
 */
export function summarizeOrder(orderId: string): OrderSummary {
  const pliki = db
    .select({ kind: assets.kind, ile: count() })
    .from(assets)
    .where(eq(assets.orderId, orderId))
    .groupBy(assets.kind)
    .all()

  const czas = db
    .select({
      // Sumujemy w bazie, nie w JavaScripcie: zleceń z setką zadań nie chcemy
      // wciągać do pamięci tylko po to, żeby policzyć różnicę dwóch liczb.
      ms: sql<number>`coalesce(sum(${jobs.finishedAt} - ${jobs.startedAt}), 0)`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.orderId, orderId),
        inArray(jobs.kind, ['image_generate', 'video_render']),
        isNotNull(jobs.startedAt),
        isNotNull(jobs.finishedAt),
      ),
    )
    .get()

  const opisy = db
    .select({ ile: count(), suma: sum(promptRuns.costUsd) })
    .from(promptRuns)
    .where(eq(promptRuns.orderId, orderId))
    .get()

  const ile = (rodzaj: string): number => pliki.find((wiersz) => wiersz.kind === rodzaj)?.ile ?? 0

  return {
    frames: ile('generated'),
    delivered: ile('export') + ile('poster'),
    stationMs: czas?.ms ?? 0,
    promptUsd: Number(opisy?.suma ?? 0),
    promptRuns: opisy?.ile ?? 0,
  }
}
