import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

import { fail, handleError } from '@/server/api/respond'
import { ensureStarted } from '@/server/bootstrap'
import { assetFilePath, getAsset } from '@/server/services/assets'

export const dynamic = 'force-dynamic'

/**
 * Serwowanie pliku po identyfikatorze, nie po ścieżce (SPEC §8, §13).
 *
 * Klient nigdy nie podaje ścieżki. Serwer składa ją z katalogu danych
 * i wartości z bazy, a `assetFilePath` sprawdza, że wynik po normalizacji
 * nadal leży w katalogu danych.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  try {
    ensureStarted()
    const { assetId } = await context.params

    const asset = getAsset(assetId)
    const path = assetFilePath(asset)

    const stats = await stat(path).catch(() => null)
    if (stats === null) {
      // Wpis w bazie jest, pliku nie ma — dla klienta to po prostu brak pliku.
      return fail('NOT_FOUND', 404)
    }

    // `Readable.toWeb` zwraca strumień typowany szerzej niż wymaga `Response`;
    // zawężenie jest bezpieczne, bo czytamy wyłącznie bajty z dysku.
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>

    // Eksporty i plansze mają się pobierać pod właściwą nazwą, a nie
    // otwierać w karcie pod identyfikatorem. Kadry i wgrane pliki zostają
    // wyświetlane w miejscu, bo służą do oglądania w galerii.
    const doPobrania = asset.kind === 'export' || asset.kind === 'poster'
    const nazwa = asset.path.split('/').pop() ?? 'plik'

    return new Response(body, {
      headers: {
        'Content-Type': asset.mime,
        'Content-Length': String(stats.size),
        ...(doPobrania
          ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(nazwa)}"` }
          : {}),
        // Pliki są niezmienne — nazwa zawiera identyfikator, więc podmiana
        // treści pod tym samym adresem nie następuje.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    return handleError(error, 'GET /api/files/[assetId]')
  }
}
