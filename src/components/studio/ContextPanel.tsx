'use client'

import { useState } from 'react'

import { Button, EmptyState, Field, Select } from '@/components/ui/primitives'
import { messageForCode } from '@/lib/messages'
import { OUTPUT_PRESETS, PURPOSE_KEYS } from '@/lib/output-presets'
import type { Asset, ErrorResponse } from '@/types/api'

/**
 * Panel kontekstowy po prawej (SPEC §10): Brief albo Montaż, albo Eksport.
 * To, co widać, zależy od tego, co grafik zaznaczył w galerii.
 */

type Tab = 'export' | 'video'

const PURPOSE_OPTIONS = PURPOSE_KEYS.map((key) => ({
  value: key,
  label: OUTPUT_PRESETS[key].label,
}))

const ASPECT_OPTIONS = [
  { value: 'vertical', label: 'Pionowy' },
  { value: 'square', label: 'Kwadratowy' },
  { value: 'horizontal', label: 'Poziomy' },
]

export function ContextPanel({
  orderId,
  asset,
  disabled,
  onQueued,
}: {
  orderId: string
  asset: Asset | null
  disabled: boolean
  onQueued: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [purpose, setPurpose] = useState<string>('services-wide')
  const [aspect, setAspect] = useState('vertical')
  const [pingPong, setPingPong] = useState(true)
  const [targetMb, setTargetMb] = useState(4)

  if (asset === null) {
    return (
      <EmptyState>
        Zaznacz kadr w galerii, a pojawią się tu opcje eksportu. Dla klipu wideo pojawi się
        montaż.
      </EmptyState>
    )
  }

  const tab: Tab = asset.mime.startsWith('video/') ? 'video' : 'export'
  const preset = OUTPUT_PRESETS[purpose as keyof typeof OUTPUT_PRESETS]

  async function send(body: Record<string, unknown>): Promise<void> {
    setBusy(true)
    setProblem(null)

    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        setProblem(messageForCode(error.errorCode))
        return
      }

      onQueued()
    } catch {
      setProblem('Nie udało się wysłać zadania. Sprawdź połączenie i spróbuj jeszcze raz.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium text-ink">
        {tab === 'export' ? 'Eksport' : 'Montaż'}
      </h3>

      {problem !== null && (
        <p role="alert" className="rounded border border-danger bg-danger/10 px-3 py-2 text-sm">
          {problem}
        </p>
      )}

      {tab === 'export' ? (
        <>
          <Field label="Gdzie ten plik trafi" hint="Od tego zależy rozmiar pliku i jego waga.">
            {(id) => (
              <Select id={id} value={purpose} onChange={setPurpose} options={PURPOSE_OPTIONS} />
            )}
          </Field>

          <p className="text-xs text-ink-muted">
            Wyjdzie {preset.deliver.width} × {preset.deliver.height} pikseli, maksymalnie{' '}
            {preset.maxWeightKb} KB, w formatach {preset.formats.join(' i ').toUpperCase()}.
            Jakość dobierzemy sami tak, żeby zmieścić się w wadze.
          </p>

          <Button
            variant="primary"
            disabled={disabled || busy}
            onClick={() =>
              void send({ kind: 'image_export', orderId, assetId: asset.id, purpose })
            }
          >
            {busy ? 'Wysyłam…' : 'Zapisz plik do oddania'}
          </Button>
        </>
      ) : (
        <>
          <Field label="Kadr" hint="Środek kadru zostaje, boki schodzą.">
            {(id) => (
              <Select id={id} value={aspect} onChange={setAspect} options={ASPECT_OPTIONS} />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pingPong}
              onChange={(event) => setPingPong(event.target.checked)}
            />
            Pętla tam i z powrotem
          </label>

          <Field label="Docelowa waga pliku" hint="W megabajtach. Mniej znaczy szybsze ładowanie.">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={targetMb}
                onChange={(event) => setTargetMb(Number(event.target.value))}
                className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm"
              />
            )}
          </Field>

          <Button
            variant="primary"
            disabled={disabled || busy}
            onClick={() =>
              void send({
                kind: 'video_render',
                orderId,
                assetId: asset.id,
                targetMb,
                poster: true,
                operations: [
                  { kind: 'crop', aspect },
                  ...(pingPong ? [{ kind: 'loop', pingPong: true }] : []),
                ],
              })
            }
          >
            {busy ? 'Wysyłam…' : 'Złóż wideo'}
          </Button>

          <p className="text-xs text-ink-muted">
            Powstaną dwa pliki — jeden dla przeglądarek nowszych, drugi dla starszych — oraz
            plansza pokazywana, zanim film ruszy.
          </p>
        </>
      )}
    </div>
  )
}
