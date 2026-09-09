'use client'

import { useEffect, useState } from 'react'

import type { HealthResponse } from '@/types/api'

/**
 * Baner stanu stacji (SPEC §10).
 *
 * Gdy generowanie jest niedostępne, formularz briefu jest zablokowany,
 * a grafik dostaje zdanie mówiące, co zrobić — nie kod i nie nazwę narzędzia.
 */
export function HealthBanner({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check(): Promise<void> {
      try {
        const response = await fetch('/api/health')
        if (!response.ok) throw new Error('health niedostępne')
        const data = (await response.json()) as HealthResponse
        if (cancelled) return
        setHealth(data)
        onReadyChange(data.ready)
      } catch {
        if (cancelled) return
        setHealth(null)
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
  }, [onReadyChange])

  if (health === null) {
    return (
      <div className="border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink-muted">
        Sprawdzam, czy stacja odpowiada…
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
