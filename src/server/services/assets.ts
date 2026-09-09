import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'

import { and, eq } from 'drizzle-orm'

import { env } from '@/lib/env'
import { ApiError } from '@/server/adapters/types'
import { db } from '@/server/db/client'
import { assets, type Asset } from '@/server/db/schema'
import { resolveAssetPath, toRelativePath } from './paths'

/**
 * Rejestr plików. Klient posługuje się wyłącznie `assetId`; ścieżkę składa
 * serwer z katalogu danych i wartości z bazy, a potem sprawdza, że wynik
 * nadal leży w katalogu danych (SPEC §13).
 */

export interface RegisterAssetInput {
  orderId: string
  jobId: string | null
  kind: Asset['kind']
  /** Ścieżka bezwzględna do pliku, który już leży na dysku. */
  absolutePath: string
  mime: string
  width?: number
  height?: number
  durationMs?: number
  seed?: number
  metadata?: unknown
}

export async function registerAsset(input: RegisterAssetInput): Promise<Asset> {
  const relativePath = toRelativePath(env.STUDIO_DATA_DIR, input.absolutePath)
  const stats = await stat(input.absolutePath)

  const row: Asset = {
    id: randomUUID(),
    orderId: input.orderId,
    jobId: input.jobId,
    kind: input.kind,
    path: relativePath,
    mime: input.mime,
    bytes: stats.size,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    seed: input.seed ?? null,
    metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
    starred: 0,
    createdAt: Date.now(),
  }

  db.insert(assets).values(row).run()
  return row
}

export function getAsset(id: string): Asset {
  const row = db.select().from(assets).where(eq(assets.id, id)).get()
  if (row === undefined) {
    throw new ApiError('NOT_FOUND', 'nie ma takiego pliku', 404)
  }
  return row
}

/**
 * Plik należący do wskazanego zlecenia.
 *
 * Serwisy brały `getAsset(assetId)` bez sprawdzania właściciela, więc dało się
 * zamówić montaż albo eksport cudzego pliku, podając własne `orderId`. Wynik
 * lądował wtedy w katalogu zamawiającego. Przy jednym grafiku nie miało to
 * znaczenia; odkąd panel ma więcej niż jedną osobę, ma.
 */
export function getOrderAsset(orderId: string, assetId: string): Asset {
  const row = db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.orderId, orderId)))
    .get()

  if (row === undefined) {
    // Ten sam kod co przy braku pliku: odpowiedź nie ma zdradzać, że plik
    // istnieje, tylko należy do kogoś innego.
    throw new ApiError('NOT_FOUND', 'nie ma takiego pliku w tym zleceniu', 404)
  }

  return row
}

/** Bezpieczna ścieżka do pliku na dysku. Jedyna droga od `assetId` do bajtów. */
export function assetFilePath(asset: Asset): string {
  return resolveAssetPath(env.STUDIO_DATA_DIR, asset.path)
}

export function setStarred(id: string, starred: boolean): void {
  db.update(assets)
    .set({ starred: starred ? 1 : 0 })
    .where(eq(assets.id, id))
    .run()
}

/**
 * Kasuje pojedynczy plik: wiersz w bazie i bajty z dysku.
 *
 * Kolejność ma znaczenie — najpierw dysk, potem baza. Odwrotnie zostawiałby
 * przy awarii wiersz wskazujący na nieistniejący plik, czyli dokładnie ten
 * stan, którego galeria nie umie pokazać.
 */
export async function deleteAsset(id: string): Promise<void> {
  const asset = getAsset(id)
  const sciezka = assetFilePath(asset)

  // Brak pliku nie jest powodem, żeby zostawić wiersz — to ten sam skutek.
  await rm(sciezka, { force: true })

  db.delete(assets).where(eq(assets.id, id)).run()
}
