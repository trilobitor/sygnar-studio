import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { ApiError } from '@/server/adapters/types'
import { handleError, fail } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { getOrder, listAssets } from '@/server/services/orders'
import { brakujaceFormaty, sprawdzPlik } from '@/server/services/quality-check'
import { zbudujZip, type WpisArchiwum } from '@/server/services/zip'

export const dynamic = 'force-dynamic'

/** Nazwa pliku bez katalogów — ścieżka w bazie jest względna wobec danych. */
function nazwaPliku(sciezka: string): string {
  return sciezka.split('/').pop() ?? sciezka
}

/** Nazwa archiwum: `<zlecenie>-do-oddania.zip`, bez znaków spoza ASCII. */
function nazwaArchiwum(nazwaZlecenia: string): string {
  const bezOgonkow = nazwaZlecenia
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  return `${bezOgonkow.length > 0 ? bezOgonkow : 'zlecenie'}-do-oddania.zip`
}

/**
 * Paczka do oddania: wszystkie pliki eksportu w jednym archiwum, razem z kartą
 * kontrolną.
 *
 * Dotąd nie było żadnej drogi pobrania wyników zbiorczo — grafik zapisywał
 * każdy plik osobno, przez łącze prywatne, pilnując nazw ręcznie.
 *
 * Karta kontrolna niesie te same zastrzeżenia, które panel pokazuje na ekranie:
 * jeżeli plik zszedł do niskiej jakości albo nie zgadza się wymiarem, klient
 * dowie się o tym z paczki, a nie po wdrożeniu.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    ensureStarted()
    wymagajSesji(request)

    const { id } = await context.params
    const order = getOrder(id)

    const pliki = listAssets(id).filter(
      (asset) => asset.kind === 'export' || asset.kind === 'poster',
    )

    if (pliki.length === 0) {
      // Puste archiwum jest formalnie poprawne, ale bezużyteczne — lepiej
      // powiedzieć wprost, że nie ma czego pakować.
      return fail('NOT_FOUND', 404)
    }

    const wpisy: WpisArchiwum[] = []

    for (const plik of pliki) {
      const sciezka = join(env.STUDIO_DATA_DIR, plik.path)

      // Ścieżka składana z katalogu danych i wartości z bazy, nigdy z wejścia
      // od klienta — a i tak sprawdzamy, czy nie wyszła poza katalog.
      if (!sciezka.startsWith(env.STUDIO_DATA_DIR)) {
        throw new ApiError('NOT_FOUND', 'plik poza katalogiem danych', 404)
      }

      wpisy.push({ nazwa: nazwaPliku(plik.path), dane: await readFile(sciezka) })
    }

    const uwagi = [
      ...pliki.flatMap((plik) =>
        sprawdzPlik(plik).map((uwaga) => `${nazwaPliku(plik.path)}: ${uwaga.tresc}`),
      ),
      ...brakujaceFormaty(pliki).map((uwaga) => uwaga.tresc),
    ]

    const karta = [
      `Zlecenie: ${order.name}`,
      `Plików: ${String(pliki.length)}`,
      '',
      ...pliki.map(
        (plik) =>
          `${nazwaPliku(plik.path)} — ${String(plik.width)} x ${String(plik.height)}, ${String(Math.round(plik.bytes / 1024))} KB, ${plik.mime}`,
      ),
      '',
      uwagi.length === 0
        ? 'Kontrola: wymiary, formaty i jakość zgadzają się z tabelą. Sam obraz oceń wzrokiem.'
        : `Kontrola — do sprawdzenia (${String(uwagi.length)}):`,
      ...uwagi.map((uwaga) => `  - ${uwaga}`),
      '',
    ].join('\n')

    wpisy.push({ nazwa: 'karta-kontrolna.txt', dane: Buffer.from(karta, 'utf8') })

    const archiwum = zbudujZip(wpisy)

    return new NextResponse(new Uint8Array(archiwum), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(archiwum.length),
        'Content-Disposition': `attachment; filename="${nazwaArchiwum(order.name)}"`,
      },
    })
  } catch (error) {
    return handleError(error, 'GET /api/orders/[id]/paczka')
  }
}
