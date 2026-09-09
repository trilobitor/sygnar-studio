'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { HealthResponse } from '@/types/api'

/**
 * Baner stanu stacji (SPEC §10).
 *
 * Gdy generowanie jest niedostępne, formularz briefu jest zablokowany,
 * a grafik dostaje zdanie mówiące, co zrobić — nie kod i nie nazwę narzędzia.
 */
/**
 * Trzy stany, nie dwa.
 *
 * Wcześniej awaria zapisywała `null` — dokładnie tę samą wartość co stan
 * początkowy — więc zerwane połączenie wyglądało identycznie jak trwające
 * sprawdzanie. Grafik patrzył w napis „Sprawdzam, czy stacja odpowiada…"
 * dowolnie długo i nie miał jak odróżnić jednego od drugiego.
 */
type StanZdrowia = 'sprawdzam' | 'blad' | HealthResponse

export function HealthBanner({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const router = useRouter()
  const [health, setHealth] = useState<StanZdrowia>('sprawdzam')

  useEffect(() => {
    let cancelled = false

    async function check(): Promise<void> {
      try {
        const response = await fetch('/api/health')

        // 401 to jedyna awaria, z którą grafik poradzi sobie sam: sesja
        // wygasła, wystarczy zalogować się ponownie.
        if (response.status === 401) {
          router.push('/logowanie')
          return
        }

        if (!response.ok) throw new Error('health niedostępne')
        const data = (await response.json()) as HealthResponse
        if (cancelled) return
        setHealth(data)
        onReadyChange(data.ready)
      } catch {
        if (cancelled) return
        setHealth('blad')
        onReadyChange(false)
      }
    }

    void check()
    // Stan stacji zmienia się rzadko — co pół minuty w zupełności wystarczy.
    const timer = setInterval(() => void check(), 30_000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [onReadyChange, router])

  if (health === 'sprawdzam') {
    return (
      <div className="border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink-muted">
        Sprawdzam, czy stacja odpowiada…
      </div>
    )
  }

  if (health === 'blad') {
    return (
      <div
        role="alert"
        className="border-b border-danger bg-danger/10 px-4 py-2 text-sm text-ink"
      >
        Nie mam kontaktu z panelem. Odśwież stronę — jeśli to nie pomoże, napisz do Kamila.
      </div>
    )
  }

  if (health.ready) {
    const missing = health.adapters.filter((adapter) => !adapter.status.ok)
    if (missing.length === 0) return null

    return (
      <div className="border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink-muted">
        Wszystko działa. Niedostępne jest tylko: {missing.map((a) => a.label).join(', ')} —
        to nie przeszkadza w generowaniu i eksporcie.
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="border-b border-danger bg-danger/15 px-4 py-2 text-sm text-ink"
    >
      Stacja jest offline. Napisz do Kamila, żeby ją włączył.
    </div>
  )
}
