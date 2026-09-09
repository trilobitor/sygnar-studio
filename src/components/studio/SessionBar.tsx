'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  COUNTDOWN_VISIBLE_SECONDS,
  formatCountdown,
  IDLE_WARNING_SECONDS,
} from '@/lib/countdown'

/**
 * Odliczanie do wylogowania i przycisk wylogowania ręcznego.
 *
 * Renderuje się **w linii z paskiem etapów**, nie we własnym wierszu —
 * osobny pasek zabierałby pionowe miejsce podglądowi kadru, a to jest
 * najcenniejsza przestrzeń na tym ekranie.
 *
 * Liczy się **bezczynność**, nie czas od zalogowania. Każdy ruch myszą,
 * klawisz albo dotyk odnawia pełną pulę — inaczej licznik gasiłby sesję
 * w połowie pisania briefu.
 *
 * [ZAŁOŻENIE] To jest wygoda i higiena, nie granica bezpieczeństwa.
 * Wylogowanie kasuje ciasteczko po stronie serwera, więc ta przeglądarka
 * traci dostęp naprawdę. Ale nie ma serwerowej listy sesji, więc ciasteczko
 * skopiowane wcześniej na inną maszynę pozostaje ważne do końca swojego
 * terminu. Prawdziwe unieważnianie wymagałoby tabeli sesji — poza wersją 1.
 */

/** Jak często odświeżamy licznik. Sekunda wystarczy, a nie męczy przeglądarki. */
const TICK_MS = 1000

/** Zdarzenia, które uznajemy za oznakę życia po drugiej stronie. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function SessionBar({
  timeoutSeconds,
  kto,
}: {
  timeoutSeconds: number
  /** Imię zalogowanej osoby — od kiedy panel ma więcej niż jednego użytkownika. */
  kto: string | null
}) {
  const router = useRouter()
  const [remaining, setRemaining] = useState(timeoutSeconds)
  const [loggingOut, setLoggingOut] = useState(false)

  // Moment ostatniej aktywności trzymamy w referencji, żeby jego zmiana
  // nie wywoływała ponownego renderu przy każdym drgnięciu myszy.
  // Zero jako wartość początkowa, bo `Date.now()` podczas renderu łamie
  // regułę czystości — prawdziwy czas wpisujemy w efekcie, po zamontowaniu.
  const lastActivity = useRef(0)

  const logout = useCallback(async (): Promise<void> => {
    setLoggingOut(true)
    try {
      await fetch('/api/auth', { method: 'DELETE' })
    } catch {
      // Nawet gdy żądanie nie doszło, odsyłamy na ekran logowania —
      // przy braku sieci i tak nic tu po użytkowniku.
    } finally {
      router.replace('/logowanie')
      router.refresh()
    }
  }, [router])

  useEffect(() => {
    lastActivity.current = Date.now()

    function markActivity(): void {
      lastActivity.current = Date.now()
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true })
    }

    const timer = setInterval(() => {
      const idleSeconds = Math.floor((Date.now() - lastActivity.current) / 1000)
      const left = Math.max(0, timeoutSeconds - idleSeconds)

      setRemaining(left)

      if (left === 0) {
        clearInterval(timer)
        void logout()
      }
    }, TICK_MS)

    return () => {
      clearInterval(timer)
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActivity)
      }
    }
  }, [timeoutSeconds, logout])

  const urgent = remaining <= IDLE_WARNING_SECONDS
  // Licznik jest ukryty aż do ostatniej minuty — patrz `COUNTDOWN_VISIBLE_SECONDS`.
  const showCountdown = remaining <= COUNTDOWN_VISIBLE_SECONDS

  return (
    <div className="flex shrink-0 items-center gap-2 text-xs">
      {kto !== null && (
        // Przy wspólnym haśle nie było czego pokazywać. Odkąd hasła są osobne,
        // widać, czyja to sesja — inaczej łatwo zapomnieć, że panel jest
        // otwarty na cudzym koncie.
        <span className="text-ink-muted">{kto}</span>
      )}

      {showCountdown && (
        <span
          className="tabular-nums text-danger-text"
          // Czytnik ekranu ma ogłaszać dopiero końcówkę, nie każdą sekundę.
          aria-live={urgent ? 'polite' : 'off'}
        >
          Automatyczne wylogowanie za: {formatCountdown(remaining)}
        </span>
      )}

      <button
        type="button"
        onClick={() => void logout()}
        disabled={loggingOut}
        aria-label="Wyloguj się"
        title="Wyloguj się"
        className="rounded p-1 text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        {/* Strzałka wychodząca z drzwi. Ikona ma `aria-label` na przycisku,
            więc sam rysunek jest dla czytnika ekranu niewidoczny. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  )
}
