'use client'

import { useState } from 'react'

import { messageForCode } from '@/lib/messages'
import type { ErrorResponse } from '@/types/api'

/**
 * Liczby do wyceny zlecenia, zwinięte domyślnie.
 *
 * Tabela `prompt_runs` zapisywała koszt każdego wywołania modelu i nikt jej
 * nigdy nie czytał; czas pracy stacji leżał w znacznikach zadań i też nigdzie
 * się nie pojawiał. To są dokładnie te liczby, które właściciel chce widzieć
 * przy wycenie — dotąd trzeba było ich szukać w bazie.
 *
 * Dane pobieramy dopiero po rozwinięciu: szczegół zlecenia jest odpytywany
 * przy każdej zmianie w kolejce, a agregaty tyle razy liczone być nie muszą.
 */

interface Podsumowanie {
  frames: number
  delivered: number
  stationMs: number
  promptUsd: number
  promptRuns: number
}

function czas(ms: number): string {
  if (ms < 1000) return 'poniżej sekundy'

  const sekundy = Math.round(ms / 1000)
  if (sekundy < 90) return `${String(sekundy)} s`

  const minuty = Math.floor(sekundy / 60)
  if (minuty < 60) return `${String(minuty)} min ${String(sekundy % 60)} s`

  return `${String(Math.floor(minuty / 60))} h ${String(minuty % 60)} min`
}

export function OrderSummary({ orderId }: { orderId: string }) {
  const [dane, setDane] = useState<Podsumowanie | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [laduje, setLaduje] = useState(false)

  async function pobierz(): Promise<void> {
    setLaduje(true)
    setProblem(null)

    try {
      const odpowiedz = await fetch(`/api/orders/${orderId}/podsumowanie`)

      if (!odpowiedz.ok) {
        const blad = (await odpowiedz.json()) as ErrorResponse
        setProblem(messageForCode(blad.errorCode))
        return
      }

      const ciało = (await odpowiedz.json()) as { podsumowanie: Podsumowanie }
      setDane(ciało.podsumowanie)
    } catch {
      setProblem('Nie udało się policzyć podsumowania. Spróbuj jeszcze raz.')
    } finally {
      setLaduje(false)
    }
  }

  return (
    <details
      className="rounded border border-line bg-surface-1 text-sm"
      onToggle={(event) => {
        // Liczymy raz na otwarcie panelu, nie przy każdym rozwinięciu.
        if (event.currentTarget.open && dane === null && !laduje) void pobierz()
      }}
    >
      <summary className="cursor-pointer px-3 py-2 text-ink-muted">Podsumowanie zlecenia</summary>

      <div className="border-t border-line px-3 py-2">
        {problem !== null && (
          <p role="alert" className="text-danger">
            {problem}
          </p>
        )}

        {problem === null && dane === null && <p className="text-ink-muted">Liczę…</p>}

        {dane !== null && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-ink-muted">Policzone kadry</dt>
            <dd className="text-ink">{dane.frames}</dd>

            <dt className="text-ink-muted">Pliki do oddania</dt>
            <dd className="text-ink">{dane.delivered}</dd>

            <dt className="text-ink-muted">Czas pracy stacji</dt>
            <dd className="text-ink">{czas(dane.stationMs)}</dd>

            <dt className="text-ink-muted">Opisy przygotowane</dt>
            <dd className="text-ink">{dane.promptRuns}</dd>

            {dane.promptRuns > 0 && (
              <>
                <dt className="text-ink-muted">Zużycie na opisy</dt>
                <dd className="text-ink">
                  {dane.promptUsd.toFixed(2)} USD
                  {/* D14: przy subskrypcji to przelicznik zużycia, nie kwota
                      do zapłacenia. Bez tego zdania liczba wprowadza w błąd. */}
                  <span className="ml-1 text-xs text-ink-muted">
                    (przelicznik zużycia, nie rachunek)
                  </span>
                </dd>
              </>
            )}
          </dl>
        )}
      </div>
    </details>
  )
}
