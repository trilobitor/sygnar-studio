'use client'

import { useEffect, useState } from 'react'

import { messageForCode } from '@/lib/messages'
import { Button } from '@/components/ui/primitives'
import { activeJobs, formatElapsed } from './use-queue'
import type { Job } from '@/types/api'

/**
 * Pasek kolejki na dole ekranu (SPEC §10).
 *
 * Pokazuje, co się dzieje, jak długo już trwa i daje przycisk Anuluj.
 * Zadanie potrafi trwać osiem minut — grafik musi widzieć, że coś żyje.
 */
export function QueueBar({ jobs, onChanged }: { jobs: Job[]; onChanged: () => void }) {
  const [tick, setTick] = useState(0)
  const [cancelling, setCancelling] = useState<string | null>(null)

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

  if (running === undefined && waiting.length === 0) {
    return (
      <div className="flex items-center justify-between border-t border-line bg-surface-1 px-4 py-2 text-sm text-ink-muted">
        <span>Stacja jest wolna.</span>
        {lastFailed !== undefined && (
          <span className="text-danger">{messageForCode(lastFailed.errorCode)}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-sm">
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
            : `W kolejce, ${waiting.length} zadania przed Tobą`}
        </span>
      )}
    </div>
  )
}
