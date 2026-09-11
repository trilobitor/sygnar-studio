'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { NARZEDZIA, type Narzedzie } from '@/lib/narzedzia'
import type { Job } from '@/types/api'

import { SessionBar } from './SessionBar'
import { Wordmark } from './Wordmark'

/**
 * Ekran wyboru narzędzia (sekcja C audytu, C1).
 *
 * Kafelki powstają z rejestru `NARZEDZIA`, nie z ręcznie pisanych kart —
 * dopisanie trzeciego narzędzia to dopisanie wpisu do tablicy.
 */

/** Jak często pytamy, czy coś się liczy. Dziesięć sekund wystarczy na ekranie,
 *  z którego i tak zaraz się wychodzi. */
const ODSWIEZANIE_MS = 10_000

export function Kafelki({
  autoLogoutSeconds,
  kto,
  niedostepne = [],
}: {
  autoLogoutSeconds: number
  kto: string | null
  /**
   * Klucze narzędzi, które na tej stacji nie są skonfigurowane.
   *
   * Rejestr mówi, co narzędzie **umie**; konfiguracja mówi, czy da się tego
   * użyć tutaj. Bez tego stacja bez katalogu FastVideo obiecywałaby kafelek
   * prowadzący do przycisku, który i tak jest wyszarzony.
   */
  niedostepne?: readonly string[]
}) {
  /*
   * Biegnące zadania, żeby kafelek mógł pokazać, że narzędzie właśnie pracuje.
   * To jedyny powód, dla którego ten ekran w ogóle pyta serwer.
   */
  const [zadania, setZadania] = useState<readonly Job[]>([])

  useEffect(() => {
    let zywy = true

    async function pobierz(): Promise<void> {
      try {
        // Endpoint oddaje ostatnie pięćdziesiąt zadań bez filtrowania —
        // sprawdzone w `api/jobs/route.ts`. Filtrujemy tutaj, zamiast
        // dokładać parametr, którego trasa i tak by nie przeczytała.
        const odpowiedz = await fetch('/api/jobs')
        if (!odpowiedz.ok) return

        const dane = (await odpowiedz.json()) as { jobs?: Job[] }
        if (zywy) setZadania((dane.jobs ?? []).filter((z) => z.status === 'running'))
      } catch {
        // Brak odpowiedzi znaczy tyle, że nie pokażemy znacznika pracy.
        // Ekran wyboru narzędzia ma działać także wtedy, gdy stacja milczy.
      }
    }

    void pobierz()
    const licznik = setInterval(() => void pobierz(), ODSWIEZANIE_MS)

    return () => {
      zywy = false
      clearInterval(licznik)
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0">
      {/* Górny pasek: znak po lewej, wylogowanie po prawej, w jednej linii. */}
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <Wordmark />
        {autoLogoutSeconds > 0 && <SessionBar timeoutSeconds={autoLogoutSeconds} kto={kto} />}
      </header>

      {/* Treść wyśrodkowana w pionie: przy dwóch kafelkach przyklejenie ich do
          górnej krawędzi zostawiało trzy czwarte ekranu pustego. */}
      <main
        id="tresc"
        className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-10"
      >
        <h1 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Wybierz narzędzie
        </h1>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {NARZEDZIA.map((n) => (
            <Kafelek
              key={n.klucz}
              narzedzie={
                niedostepne.includes(n.klucz)
                  ? {
                      ...n,
                      stan: 'niedostepne',
                      powod: 'Nie skonfigurowano na tej stacji.',
                    }
                  : n
              }
              pracuje={pracuje(n, zadania)}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

/** Czy któreś z biegnących zadań należy do tego narzędzia. */
function pracuje(n: Narzedzie, zadania: readonly Job[]): boolean {
  return zadania.some((z) => n.rodzajeZadan.includes(z.kind))
}

/** Ikona narzędzia: ścieżki z rejestru w siatce 24 × 24, rysowane obrysem. */
function Ikona({ sciezki }: { sciezki: readonly string[] }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-20 w-20"
    >
      {sciezki.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

function Kafelek({ narzedzie, pracuje }: { narzedzie: Narzedzie; pracuje: boolean }) {
  const dostepne = narzedzie.stan === 'dostepne'

  const wnetrze = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-accent">
          <Ikona sciezki={narzedzie.ikona} />
        </span>

        {pracuje && (
          <span className="rounded border border-accent px-2 py-0.5 text-xs text-accent">
            pracuje
          </span>
        )}

        {!dostepne && !pracuje && (
          <span className="rounded border border-field px-2 py-0.5 text-xs text-ink-muted">
            {narzedzie.stan === 'wkrotce' ? 'wkrótce' : 'niedostępne'}
          </span>
        )}
      </div>

      <h2 className="mt-6 text-2xl font-medium text-ink">{narzedzie.nazwa}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        {narzedzie.opis}
      </p>

      {/* Powód wprost na kafelku, nie w dymku — grafik ma wiedzieć, na co czeka,
          bez najeżdżania na cokolwiek. */}
      {narzedzie.powod !== undefined && (
        <p className="mt-auto border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
          {narzedzie.powod}
        </p>
      )}
    </>
  )

  /*
   * Kwadrat, nie prostokąt. Przy dwóch kafelkach szeroki prostokąt wyglądał
   * jak pasek, a nie jak wybór narzędzia — kwadrat czyta się jak kafelek.
   */
  /*
   * `min-h` zamiast samego `aspect-square`: proporcja wyznacza wysokość
   * z szerokości, ale treść dłuższa niż kwadrat i tak go rozpycha — i wtedy
   * kafelki przestają być równe. Minimalna wysokość trzyma kwadrat jako
   * podłogę, a siatka wyrównuje oba do wyższego.
   */
  const wspolne =
    'flex aspect-square min-h-full flex-col rounded-xl border p-8 text-left transition'

  if (!dostepne) {
    /*
     * Niedostępny kafelek też odpowiada na najechanie — rozjaśnia się i
     * podświetla obramowanie. Nie po to, żeby udawać klikalny (kursor mówi
     * wprost, że nie jest), tylko żeby powód niedostępności dał się przeczytać
     * bez wysiłku i żeby ekran nie wyglądał na wpół zepsuty.
     */
    return (
      <div
        aria-disabled="true"
        className={`${wspolne} cursor-not-allowed border-line bg-surface-1 opacity-60 hover:border-field hover:opacity-90`}
      >
        {wnetrze}
      </div>
    )
  }

  return (
    <Link
      href={`/n/${narzedzie.klucz}`}
      className={`${wspolne} border-field bg-surface-1 hover:border-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
    >
      {wnetrze}
    </Link>
  )
}
