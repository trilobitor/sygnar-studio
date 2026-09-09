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
  request: Request,
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

    // Eksporty i plansze mają się pobierać pod właściwą nazwą, a nie
    // otwierać w karcie pod identyfikatorem. Kadry i wgrane pliki zostają
    // wyświetlane w miejscu, bo służą do oglądania w galerii.
    const doPobrania = asset.kind === 'export' || asset.kind === 'poster'
    const nazwa = asset.path.split('/').pop() ?? 'plik'

    const wspolne: Record<string, string> = {
      'Content-Type': asset.mime,
      // Bez tego przeglądarka nie wie, że wolno prosić o fragment, i wyłącza
      // pasek przewijania w podglądzie wideo.
      'Accept-Ranges': 'bytes',
      ...(doPobrania
        ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(nazwa)}"` }
        : {}),
      // Pliki są niezmienne — nazwa zawiera identyfikator, więc podmiana
      // treści pod tym samym adresem nie następuje.
      'Cache-Control': 'private, max-age=31536000, immutable',
    }

    const zakres = przeczytajZakres(request.headers.get('range'), stats.size)

    if (zakres === 'bledny') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${stats.size}`, 'Accept-Ranges': 'bytes' },
      })
    }

    if (zakres !== null) {
      const czesc = Readable.toWeb(
        createReadStream(path, { start: zakres.od, end: zakres.do }),
      ) as ReadableStream<Uint8Array>

      return new Response(czesc, {
        status: 206,
        headers: {
          ...wspolne,
          'Content-Range': `bytes ${zakres.od}-${zakres.do}/${stats.size}`,
          'Content-Length': String(zakres.do - zakres.od + 1),
        },
      })
    }

    // `Readable.toWeb` zwraca strumień typowany szerzej niż wymaga `Response`;
    // zawężenie jest bezpieczne, bo czytamy wyłącznie bajty z dysku.
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>

    return new Response(body, {
      headers: { ...wspolne, 'Content-Length': String(stats.size) },
    })
  } catch (error) {
    return handleError(error, 'GET /api/files/[assetId]')
  }
}

/**
 * Nagłówek `Range` w postaci `bytes=od-do`.
 *
 * Bez obsługi zakresów przeglądarka ściągała cały plik, zanim pokazała
 * cokolwiek, i nie dawała przewijać podglądu wideo — pasek postępu był
 * martwy. Obsługujemy jeden zakres; wiele naraz to rzadkość, której żaden
 * odtwarzacz tu nie użyje.
 *
 * Zwraca `null`, gdy nagłówka nie ma, i `'bledny'`, gdy zakres wykracza poza
 * plik — to dwie różne odpowiedzi: 200 i 416.
 */
function przeczytajZakres(
  naglowek: string | null,
  rozmiar: number,
): { od: number; do: number } | 'bledny' | null {
  if (naglowek === null) return null

  const dopasowanie = /^bytes=(\d*)-(\d*)$/.exec(naglowek.trim())
  if (dopasowanie === null) return null

  const [, odTekst, doTekst] = dopasowanie
  if (odTekst === undefined || doTekst === undefined) return null

  // `bytes=-500` znaczy „ostatnie 500 bajtów".
  if (odTekst === '') {
    if (doTekst === '') return 'bledny'
    const ile = Number(doTekst)
    if (ile <= 0) return 'bledny'
    return { od: Math.max(0, rozmiar - ile), do: rozmiar - 1 }
  }

  const od = Number(odTekst)
  const koniec = doTekst === '' ? rozmiar - 1 : Number(doTekst)

  if (!Number.isFinite(od) || !Number.isFinite(koniec)) return 'bledny'
  if (od >= rozmiar || od < 0 || koniec < od) return 'bledny'

  return { od, do: Math.min(koniec, rozmiar - 1) }
}
