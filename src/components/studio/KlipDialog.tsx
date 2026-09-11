'use client'

import { useState } from 'react'

import { Button, Dialog, Field, Select, TextArea } from '@/components/ui/primitives'
import { messageForCode } from '@/lib/messages'
import type { ErrorResponse } from '@/types/api'

/**
 * Zamówienie klipu z opisu.
 *
 * Osobne okno, nie zakładka w briefie: brief opisuje **scenę do kadru**
 * i ma pola, które dla wideo nic nie znaczą (proporcje slotu, liczba kadrów).
 * Wspólny formularz musiałby połowę z nich chować, a to jest gorsze niż
 * drugie, krótkie okno.
 *
 * Czas przy każdym wariancie stoi wprost w etykiecie. Zadanie z sekcji C
 * wymaga, żeby grafik **przed** zleceniem wiedział, na jak długo zajmie
 * stację — a przy pięciu minutach to nie jest szczegół.
 */

const WARIANTY = [
  { value: 'podglad', label: 'Szybki podgląd — 480p, 2 s, około pół minuty' },
  { value: 'oddanie', label: 'Wersja do oddania — 720p, 5 s, około pięciu minut' },
]

export function KlipDialog({
  open,
  orderId,
  onClose,
  onQueued,
}: {
  open: boolean
  orderId: string
  onClose: () => void
  onQueued: () => void
}) {
  const [opis, setOpis] = useState('')
  const [wariant, setWariant] = useState('podglad')
  const [wysylam, setWysylam] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function zamow(): Promise<void> {
    setWysylam(true)
    setProblem(null)

    try {
      const odpowiedz = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'video_generate', orderId, promptEn: opis.trim(), wariant }),
      })

      if (!odpowiedz.ok) {
        const blad = (await odpowiedz.json()) as ErrorResponse
        setProblem(messageForCode(blad.errorCode))
        return
      }

      onQueued()
      onClose()
      setOpis('')
    } catch {
      // Bez tego `void zamow()` gubiłby odrzucenie obietnicy i grafik
      // zostawałby z oknem, które nic nie mówi (ta sama pułapka co SYG-003).
      setProblem('Nie udało się zamówić klipu. Sprawdź, czy stacja odpowiada.')
    } finally {
      setWysylam(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Zamów klip"
      footer={
        <Button
          variant="primary"
          disabled={wysylam || opis.trim().length < 10}
          onClick={() => void zamow()}
        >
          {wysylam ? 'Wysyłam…' : 'Zamów'}
        </Button>
      }
    >
      <Field
        label="Opis ujęcia"
        hint="Po angielsku, jak przy kadrze. Opisz scenę i ruch kamery — na przykład „slow camera push in”."
      >
        {(id) => (
          <TextArea
            id={id}
            value={opis}
            onChange={setOpis}
            rows={4}
            maxLength={2000}
            lang="en"
          />
        )}
      </Field>

      <Field label="Wariant" hint="Podgląd kosztuje dziesięć razy mniej czasu stacji niż wersja do oddania.">
        {(id) => <Select id={id} value={wariant} onChange={setWariant} options={WARIANTY} />}
      </Field>

      <p className="text-xs leading-relaxed text-ink-muted">
        Klip liczy się w tle. Możesz zamknąć to okno — postęp widać na pasku
        kolejki, a gotowy plik pojawi się w galerii. W czasie liczenia klipu
        stacja nie policzy kadru: oba modele nie mieszczą się naraz w pamięci.
      </p>

      {problem !== null && (
        <p role="alert" className="text-xs text-danger-text">
          {problem}
        </p>
      )}
    </Dialog>
  )
}
