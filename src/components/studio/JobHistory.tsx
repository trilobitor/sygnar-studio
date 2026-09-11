'use client'

import { useState } from 'react'

import { JOB_LABELS, messageForCode } from '@/lib/messages'
import type { ErrorResponse, Job } from '@/types/api'

/**
 * Historia zadań zlecenia.
 *
 * Tabela `jobs` niosła komplet: rodzaj, status, kod błędu i znaczniki czasu —
 * a panel pokazywał wyłącznie to, co dzieje się **teraz**, na pasku na dole
 * ekranu. Po zamknięciu przeglądarki nie było jak sprawdzić, czy wczorajszy
 * montaż w ogóle się udał ani dlaczego nie.
 *
 * Zwinięta domyślnie: to jest rzecz, do której się zagląda, a nie taka,
 * która ma zabierać miejsce podglądowi.
 */

const STATUSY: Record<string, string> = {
  queued: 'czeka',
  running: 'w toku',
  done: 'gotowe',
  failed: 'nieudane',
  cancelled: 'przerwane',
}

function czasTrwania(job: Job): string {
  if (job.startedAt === null) return '—'
  if (job.finishedAt === null) return 'trwa'

  const sekundy = Math.round((job.finishedAt - job.startedAt) / 1000)
  return sekundy < 60 ? `${String(sekundy)} s` : `${String(Math.floor(sekundy / 60))} min ${String(sekundy % 60)} s`
}

function kiedy(znacznik: number): string {
  const data = new Date(znacznik)
  const godzina = data.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

  return new Date().toDateString() === data.toDateString()
    ? godzina
    : `${data.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })} ${godzina}`
}

export function JobHistory({ jobs, onChanged }: { jobs: Job[]; onChanged: () => void }) {
  const [problem, setProblem] = useState<string | null>(null)
  const [powtarzane, setPowtarzane] = useState<string | null>(null)

  const historia = [...jobs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)

  if (historia.length === 0) return null

  async function powtorz(id: string): Promise<void> {
    setPowtarzane(id)
    setProblem(null)

    try {
      const odpowiedz = await fetch(`/api/jobs/${id}/ponow`, { method: 'POST' })

      if (!odpowiedz.ok) {
        const blad = (await odpowiedz.json()) as ErrorResponse
        setProblem(messageForCode(blad.errorCode))
        return
      }

      onChanged()
    } catch {
      setProblem('Nie udało się powtórzyć zadania.')
    } finally {
      setPowtarzane(null)
    }
  }

  return (
    <details className="rounded-md border border-line bg-surface-1 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2.5 text-ink-muted transition hover:text-ink">
        Historia zadań
        <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs">{historia.length}</span>
      </summary>

      <div className="border-t border-line">
        {problem !== null && (
          <p role="alert" className="px-3 py-2 text-xs text-danger">
            {problem}
          </p>
        )}

        <ul className="divide-y divide-line">
          {historia.map((job) => (
            <li key={job.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="w-24 shrink-0 text-ink">{JOB_LABELS[job.kind] ?? 'Zadanie'}</span>

              <span
                className={`w-20 shrink-0 ${
                  job.status === 'failed' ? 'text-danger' : 'text-ink-muted'
                }`}
              >
                {STATUSY[job.status] ?? job.status}
              </span>

              <span className="w-16 shrink-0 tabular-nums text-ink-muted">{czasTrwania(job)}</span>
              <span className="flex-1 text-ink-muted">{kiedy(job.createdAt)}</span>

              {job.errorCode !== null && (
                <span className="min-w-0 flex-1 truncate text-danger" title={messageForCode(job.errorCode)}>
                  {messageForCode(job.errorCode)}
                </span>
              )}

              {/* Powtarzać da się to, co się skończyło — zadania w kolejce
                  i w biegu powtórzyłyby samą siebie. */}
              {(job.status === 'failed' || job.status === 'done' || job.status === 'cancelled') && (
                <button
                  type="button"
                  disabled={powtarzane !== null}
                  onClick={() => void powtorz(job.id)}
                  className="shrink-0 rounded border border-field px-2 py-0.5 text-ink-muted transition hover:text-ink disabled:opacity-50"
                >
                  {powtarzane === job.id ? 'Ponawiam…' : 'Ponów'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
