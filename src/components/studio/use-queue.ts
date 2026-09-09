'use client'

import { useEffect, useState } from 'react'

import type { Job } from '@/types/api'

/**
 * Stan kolejki przez SSE (SPEC §8) — jedno połączenie na klienta,
 * bez odpytywania co sekundę.
 */
export function useQueue(): { jobs: Job[]; connected: boolean } {
  const [jobs, setJobs] = useState<Job[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const source = new EventSource('/api/jobs/stream')

    source.onopen = () => {
      setConnected(true)
    }

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload: unknown = JSON.parse(event.data)
        if (
          typeof payload === 'object' &&
          payload !== null &&
          Array.isArray(Reflect.get(payload, 'jobs'))
        ) {
          // Kształt przychodzi z naszego własnego endpointu, a sprawdzenie
          // powyżej potwierdza, że to tablica zadań.
          setJobs(Reflect.get(payload, 'jobs') as Job[])
        }
      } catch {
        // Uszkodzona ramka nie może wywrócić interfejsu — czekamy na kolejną.
        setConnected(true)
      }
    }

    source.onerror = () => {
      // EventSource sam wznawia połączenie; oznaczamy tylko stan dla banera.
      setConnected(false)
    }

    return () => {
      source.close()
    }
  }, [])

  return { jobs, connected }
}

/** Zadania, które realnie zajmują stację. */
export function activeJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => job.status === 'queued' || job.status === 'running')
}

/** Czas trwania w formacie mm:ss — bez bibliotek, bo to jedno miejsce. */
export function formatElapsed(startedAt: number | null): string {
  if (startedAt === null) return '00:00'
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
