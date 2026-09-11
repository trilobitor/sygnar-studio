import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { ApiError } from '@/server/adapters/types'
import { handleError, fail } from '@/server/api/respond'
import { wymagajSesji } from '@/server/api/sesja'
import { ensureStarted } from '@/server/bootstrap'
import { getOrder, listAssets } from '@/server/services/orders'
import { brakujaceFormaty, sprawdzPlik } from '@/lib/quality-check'
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
    const brakujace: string[] = []

    for (const plik of pliki) {
      const sciezka = join(env.STUDIO_DATA_DIR, plik.path)

      // Ścieżka składana z katalogu danych i wartości z bazy, nigdy z wejścia
      // od klienta — a i tak sprawdzamy, czy nie wyszła poza katalog.
      if (!sciezka.startsWith(env.STUDIO_DATA_DIR)) {
        throw new ApiError('NOT_FOUND', 'plik poza katalogiem danych', 404)
      }

      /*
       * Brak jednego pliku nie może wywrócić całej paczki.
       *
       * Wcześniej `readFile` rzucał, obsługa błędów oddawała JSON z kodem,
       * a przeglądarka — przez `download` na odnośniku — zapisywała go jako
       * plik o nazwie archiwum. Grafik dostawał „paczka" z treścią błędu
       * zamiast roboty, i to przy panelu meldującym, że wszystko się zgadza
       * (defekt SYG-001). Wiersz w bazie może przeżyć swój plik: skasowany
       * ręcznie z dysku, przerwany zapis, pomyłka przy sprzątaniu.
       */
      const dane = await readFile(sciezka).catch((blad: unknown) => {
        const kod = (blad as NodeJS.ErrnoException).code
        if (kod !== 'ENOENT' && kod !== 'ENOTDIR') throw blad

        logger.warn('plik do oddania zniknął z dysku', { orderId: id, assetId: plik.id })
        brakujace.push(nazwaPliku(plik.path))
        return null
      })

      if (dane !== null) {
        wpisy.push({ nazwa: nazwaPliku(plik.path), dane })
      }
    }

    if (wpisy.length === 0) {
      // Żaden z plików nie istnieje — pakowanie samej karty kontrolnej byłoby
      // gorsze niż jawna odmowa.
      return fail('NOT_FOUND', 404)
    }

    const uwagi = [
      // Brak pliku idzie na sam początek: to jedyna uwaga, przy której
      // archiwum jest niepełne, a nie tylko gorsze, niż mogłoby być.
      ...brakujace.map((nazwa) => `${nazwa}: pliku nie ma na dysku, nie wszedł do paczki`),
      ...pliki.flatMap((plik) =>
        sprawdzPlik(plik).map((uwaga) => `${nazwaPliku(plik.path)}: ${uwaga.tresc}`),
      ),
      ...brakujaceFormaty(pliki).map((uwaga) => uwaga.tresc),
    ]

    const karta = [
      `Zlecenie: ${order.name}`,
      `Plików w paczce: ${String(wpisy.length)} z ${String(pliki.length)}`,
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
