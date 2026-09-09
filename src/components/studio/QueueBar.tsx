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
  const [powtarzam, setPowtarzam] = useState<string | null>(null)

  /**
   * Powtórzenie nieudanego zadania z zapisanymi parametrami.
   *
   * Bez tego grafik musiał otworzyć brief od nowa i wpisać wszystko ręcznie,
   * choć parametry leżały w bazie. Przy awarii przejściowej — pełny dysk,
   * zwolniona stacja — była to praca odtwarzana od zera bez powodu.
   */
  async function powtorz(id: string): Promise<void> {
    setPowtarzam(id)

    try {
      await fetch(`/api/jobs/${id}/ponow`, { method: 'POST' })
      setOdrzucone(id)
      onChanged()
    } finally {
      setPowtarzam(null)
    }
  }

  const active = activeJobs(jobs)
  // Wszystkie biegnące, nie pierwsze z brzegu. Pula nie-GPU przepuszcza dwa
  // zadania naraz, więc drugiego nie dało się ani zobaczyć, ani anulować.
  const biegnace = active.filter((job) => job.status === 'running')
  const running = biegnace[0]
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

  /*
   * Zwięzły komunikat dla czytnika ekranu, zamontowany **na stałe**.
   *
   * Wcześniej nic nie ogłaszało końca zadania: osoba niewidoma nie miała jak
   * się dowiedzieć, że kadry są gotowe, poza cyklicznym sprawdzaniem galerii.
   * Obszar `aria-live` dokładany dopiero z treścią bywa pomijany przez
   * czytnik, dlatego stoi zawsze, a zmienia się tylko jego zawartość.
   */
  const doOgloszenia = ((): string => {
    if (!connected) return 'Utracono kontakt ze stacją.'
    if (running !== undefined) return `Trwa: ${RODZAJE[running.kind] ?? 'zadanie'}.`
    if (waiting.length > 0) return `W kolejce: ${waiting.length}.`
    if (lastFailed !== undefined && odrzucone !== lastFailed.id) {
      return `Zadanie nieudane: ${RODZAJE[lastFailed.kind] ?? 'zadanie'}.`
    }
    return 'Stacja jest wolna, zadania zakończone.'
  })()

  // Zerwany strumień ma własny stan. Wcześniej pasek pokazywał ostatnią znaną
  // kolejkę jako aktualną, więc grafik patrzył na dane sprzed minut, nie mając
  // jak poznać, że nic już nie przychodzi.
  const ogloszenie = (
    <p role="status" aria-live="polite" className="sr-only">
      {doOgloszenia}
    </p>
  )

  if (!connected) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-t border-line bg-surface-1 px-4 py-2 text-sm text-ink-muted"
      >
        {ogloszenie}
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
          onClick={() => void powtorz(lastFailed.id)}
          disabled={powtarzam === lastFailed.id}
          className="rounded border border-accent px-2 py-0.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {powtarzam === lastFailed.id ? 'Wysyłam…' : 'Spróbuj jeszcze raz'}
        </button>
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
        {ogloszenie}
        <span>Stacja jest wolna.</span>
        {awaria}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 border-t border-line bg-surface-1 px-4 py-2 text-sm">
      {ogloszenie}
      {awaria}
      {biegnace.length > 0 ? (
        biegnace.map((zadanie) => (
          <span key={zadanie.id} className="flex items-center gap-2">
            <span className="text-ink">
              {RODZAJE[zadanie.kind] ?? 'Zadanie'}: {zadanie.phase ?? 'Pracuję'}
            </span>
            <div
              className="h-1.5 w-32 overflow-hidden rounded bg-surface-2"
              role="progressbar"
              aria-valuenow={Math.round(zadanie.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Postęp: ${RODZAJE[zadanie.kind] ?? 'zadanie'}`}
            >
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.round(zadanie.progress * 100)}%` }}
              />
            </div>
            <span className="tabular-nums text-ink-muted" key={tick}>
              {formatElapsed(zadanie.startedAt)}
            </span>
            <Button
              variant="danger"
              onClick={() => void cancel(zadanie.id)}
              disabled={cancelling === zadanie.id}
            >
              Anuluj
            </Button>
          </span>
        ))
      ) : (
        <span className="text-ink">Zaraz zaczynam…</span>
      )}

      {waiting.length > 0 && (
        <span className="text-ink-muted">
          {/* „Przed Tobą" znaczyło tu wszystko, co czeka — także zadania
              wysłane przez kogoś innego. Teraz mówimy po prostu, ile czeka. */}
          W kolejce {waiting.length}{' '}
          {odmiana(waiting.length, ['zadanie', 'zadania', 'zadań'])}
        </span>
      )}
    </div>
  )
}
