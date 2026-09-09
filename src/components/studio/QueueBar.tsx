'use client'

import { useEffect, useState } from 'react'

import { messageForCode, odmiana } from '@/lib/messages'
import { Button } from '@/components/ui/primitives'
import { activeJobs, formatElapsed } from './use-queue'
import type { Job } from '@/types/api'

/** Rodzaj zadania po polsku — bez tego komunikat nie mówił, czego dotyczy. */
const RODZAJE: Record<string, string> = {
  image_generate: 'Generowanie',
  image_export: 'Eksport',
  video_render: 'Montaż',
  photo_batch: 'Obróbka zdjęć',
}

/**
 * Pasek kolejki na dole ekranu (SPEC §10).
 *
 * Pokazuje, co się dzieje, jak długo już trwa i daje przycisk Anuluj.
 * Zadanie potrafi trwać osiem minut — grafik musi widzieć, że coś żyje.
 */
export function QueueBar({
  jobs,
  connected,
  onChanged,
}: {
  jobs: Job[]
  /** Czy strumień kolejki żyje. `false` po zerwaniu połączenia. */
  connected: boolean
  onChanged: () => void
}) {
  const [tick, setTick] = useState(0)
  const [cancelling, setCancelling] = useState<string | null>(null)
  /** Identyfikator awarii schowanej przyciskiem „Rozumiem". */
  const [odrzucone, setOdrzucone] = useState<string | null>(null)

  const active = activeJobs(jobs)
  const running = active.find((job) => job.status === 'running')
  const waiting = active.filter((job) => job.status === 'queued')

  useEffect(() => {
    if (running === undefined) return
    // Licznik czasu chodzi lokalnie, żeby nie zamęczać serwera odświeżaniem.
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [running])

  async function cancel(id: string): Promise<void> {
    setCancelling(id)
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      onChanged()
    } finally {
      setCancelling(null)
    }
  }

  const lastFailed = jobs.find((job) => job.status === 'failed')

  // Zerwany strumień ma własny stan. Wcześniej pasek pokazywał ostatnią znaną
  // kolejkę jako aktualną, więc grafik patrzył na dane sprzed minut, nie mając
  // jak poznać, że nic już nie przychodzi.
  if (!connected) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-t border-line bg-surface-1 px-4 py-2 text-sm text-ink-muted"
      >
        <span className="text-danger-text">Straciłem kontakt ze stacją.</span>
        <span>Próbuję połączyć się ponownie — zadania w toku biegną dalej.</span>
      </div>
    )
  }

  /**
   * Informacja o nieudanym zadaniu, widoczna **niezależnie od stanu kolejki**.
   *
   * Wcześniej pokazywała się wyłącznie wtedy, gdy kolejka była pusta: zadanie,
   * które padło, a po nim ruszyło następne, znikało bez śladu. Grafik nie miał
   * jak się dowiedzieć, że coś poszło nie tak, ani czego to dotyczyło.
   */
  const awaria =
    lastFailed !== undefined && odrzucone !== lastFailed.id ? (
      <span className="flex items-center gap-2">
        <span className="text-danger-text">
          {RODZAJE[lastFailed.kind] ?? 'Zadanie'} — {messageForCode(lastFailed.errorCode)}
        </span>
        <button
          type="button"
          onClick={() => setOdrzucone(lastFailed.id)}
          className="rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
        >
          Rozumiem
        </button>
      </span>
    ) : null

  if (running === undefined && waiting.length === 0) {
    return (
      <div className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-sm text-ink-muted">
        <span>Stacja jest wolna.</span>
        {awaria}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-sm">
      {awaria}
      {running !== undefined ? (
        <>
          <span className="text-ink">{running.phase ?? 'Pracuję'}</span>
          <div
            className="h-1.5 w-48 overflow-hidden rounded bg-surface-2"
            role="progressbar"
            aria-valuenow={Math.round(running.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Postęp zadania"
          >
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round(running.progress * 100)}%` }}
            />
          </div>
          <span className="tabular-nums text-ink-muted" key={tick}>
            {formatElapsed(running.startedAt)}
          </span>
          <Button
            variant="danger"
            onClick={() => void cancel(running.id)}
            disabled={cancelling === running.id}
          >
            Anuluj
          </Button>
        </>
      ) : (
        <span className="text-ink">Zaraz zaczynam…</span>
      )}

      {waiting.length > 0 && (
        <span className="text-ink-muted">
          {waiting.length === 1
            ? 'W kolejce, 1 zadanie przed Tobą'
            : `W kolejce, ${waiting.length} ${odmiana(waiting.length, [
                'zadanie',
                'zadania',
                'zadań',
              ])} przed Tobą`}
        </span>
      )}
    </div>
  )
}
