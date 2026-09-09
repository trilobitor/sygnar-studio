import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'

import { desc, eq } from 'drizzle-orm'

import { env } from '@/lib/env'
import type { CreateOrderInput } from '@/lib/schemas'
import { ApiError } from '@/server/adapters/types'
import { db } from '@/server/db/client'
import { assets, briefs, orders, type Asset, type Order } from '@/server/db/schema'
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
export function renameOrder(id: string, name: string): Order {
  getOrder(id)
  db.update(orders).set({ name, updatedAt: Date.now() }).where(eq(orders.id, id)).run()
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

export function latestBrief(orderId: string): unknown {
  const row = db
    .select()
    .from(briefs)
    .where(eq(briefs.orderId, orderId))
    .orderBy(desc(briefs.createdAt))
    .limit(1)
    .get()

  if (row === undefined) return null

  const parsed: unknown = JSON.parse(row.payloadJson)
  return parsed
}
