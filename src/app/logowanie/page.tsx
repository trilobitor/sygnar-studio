import { Suspense } from 'react'

import { LoginForm } from '@/components/studio/LoginForm'
import { Wordmark } from '@/components/studio/Wordmark'

/**
 * Ekran logowania (SPEC §13).
 *
 * Pierwsze, co widać po wejściu na panel. Znak marki i jedno pole — nic
 * poza tym, bo nie ma tu nic do wyboru.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 p-6">
      <div className="w-full max-w-sm">
        <h1 className="sr-only">Sygnar Studio — logowanie</h1>

        <div className="mb-8 flex justify-center">
          <Wordmark size="large" />
        </div>

        {/* `useSearchParams` w formularzu wymaga granicy `Suspense` —
            bez niej produkcyjny build przerywa się błędem, a strona
            do tego momentu nie może się prerenderować. */}
        <Suspense fallback={<div className="h-48 rounded-lg border border-line bg-surface-1" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Panel do grafiki i wideo. Dostęp tylko dla zespołu Sygnara.
        </p>
      </div>
    </main>
  )
}
