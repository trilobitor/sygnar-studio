'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { Button, Field } from '@/components/ui/primitives'
import { messageForCode } from '@/lib/messages'
import type { ErrorResponse } from '@/types/api'

/**
 * Formularz logowania. Jedno pole i jeden przycisk.
 *
 * Hasło nigdy nie trafia do adresu ani do logu przeglądarki — idzie
 * w treści żądania, a sesję niesie ciasteczko niedostępne dla skryptów.
 */
export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(): Promise<void> {
    if (password.length === 0) return

    setBusy(true)
    setProblem(null)

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        setProblem(messageForCode(error.errorCode))
        setPassword('')
        return
      }

      // Wracamy tam, gdzie użytkownik chciał wejść przed przekierowaniem.
      router.replace(bezpieczneWejscie(params.get('dalej')))
      router.refresh()
    } catch {
      setProblem('Nie udało się połączyć ze stacją. Sprawdź sieć i spróbuj ponownie.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface-1 p-6"
    >
      <Field label="Hasło">
        {(id) => (
          <input
            id={id}
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-field bg-surface-2 px-3 py-2 text-sm text-ink"
          />
        )}
      </Field>

      {problem !== null && (
        <p role="alert" className="rounded border border-danger bg-danger/10 px-3 py-2 text-sm">
          {problem}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
        {busy ? 'Sprawdzam…' : 'Wejdź'}
      </Button>
    </form>
  )
}

/**
 * Adres powrotu po zalogowaniu, przycięty do własnej aplikacji.
 *
 * Samo `startsWith('/')` nie wystarczało: `//zly-adres.pl` też zaczyna się od
 * ukośnika, a przeglądarka czyta to jako adres bezwzględny z bieżącym
 * protokołem. Przy panelu wystawionym publicznie dawało to otwarte
 * przekierowanie — link „zaloguj się i wróć" prowadzący gdzie indziej.
 *
 * Odrzucamy też `/\`, bo część przeglądarek normalizuje odwrotny ukośnik
 * na zwykły.
 */
export function bezpieczneWejscie(dalej: string | null): string {
  if (dalej === null || dalej.length === 0) return '/'
  if (!dalej.startsWith('/')) return '/'
  if (dalej.startsWith('//') || dalej.startsWith('/\\')) return '/'

  return dalej
}
