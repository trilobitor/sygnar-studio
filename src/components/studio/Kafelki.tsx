'use client'

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
}: {
  autoLogoutSeconds: number
  kto: string | null
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
            <Kafelek key={n.klucz} narzedzie={n} pracuje={pracuje(n, zadania)} />
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

function Kafelek({ narzedzie, pracuje }: { narzedzie: Narzedzie; pracuje: boolean }) {
  const dostepne = narzedzie.stan === 'dostepne'

  const wnetrze = (
    <>
      <div className="flex items-baseline justify-between">
        <span aria-hidden className="text-3xl leading-none text-accent">
          {narzedzie.znak}
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

      <h2 className="mt-4 text-lg font-medium text-ink">{narzedzie.nazwa}</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{narzedzie.opis}</p>

      {/* Powód wprost na kafelku, nie w dymku — grafik ma wiedzieć, na co czeka,
          bez najeżdżania na cokolwiek. */}
      {narzedzie.powod !== undefined && (
        <p className="mt-auto border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
          {narzedzie.powod}
        </p>
      )}
    </>
  )

  const wspolne = 'flex min-h-56 flex-col rounded-lg border p-6 text-left transition'

  if (!dostepne) {
    return (
      <div
        aria-disabled="true"
        className={`${wspolne} cursor-not-allowed border-line bg-surface-1 opacity-60`}
      >
        {wnetrze}
      </div>
    )
  }

  return (
    <a
      href={`/n/${narzedzie.klucz}`}
      className={`${wspolne} border-field bg-surface-1 hover:border-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
    >
      {wnetrze}
    </a>
  )
}
