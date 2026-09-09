'use client'

import { useState } from 'react'

import { Button, EmptyState, Field, Select, TextArea } from '@/components/ui/primitives'
import { FIELD_HINTS, messageForCode, zacisnij } from '@/lib/messages'
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
  const [poprawka, setPoprawka] = useState<string | null>(null)

  // Długość klipu zna serwer — sonduje ją ffprobe przy wgrywaniu. Gdy jej nie
  // ma (plik wgrany przed tą zmianą albo brak ffprobe), suwaków nie pokazujemy
  // zamiast zgadywać zakres.
  const dlugoscS = asset?.durationMs == null ? null : asset.durationMs / 1000
  const [przycinaj, setPrzycinaj] = useState(false)
  const [odS, setOdS] = useState(0)
  const [doS, setDoS] = useState(() => dlugoscS ?? 0)

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

      {tab === 'export' && asset.seed !== null && (
        <PoprawKadr
          orderId={orderId}
          asset={asset}
          disabled={disabled}
          wartosc={poprawka}
          ustawWartosc={setPoprawka}
          wyslij={send}
          zajety={busy}
        />
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
          {dlugoscS !== null && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={przycinaj}
                onChange={(event) => setPrzycinaj(event.target.checked)}
              />
              Przytnij fragment
            </label>

            {przycinaj ? (
              <div className="flex flex-col gap-2 rounded border border-line bg-surface-2 px-3 py-2">
                <Field label={`Od ${odS.toFixed(1)} s`} hint="Początek wybranego fragmentu.">
                  {(id) => (
                    <input
                      id={id}
                      type="range"
                      min={0}
                      max={dlugoscS}
                      step={0.1}
                      value={odS}
                      onChange={(event) => {
                        const wartosc = Number(event.target.value)
                        setOdS(wartosc)
                        // Koniec nigdy przed początkiem — inaczej serwer odrzuca
                        // zadanie, a grafik nie wie, o co mu chodzi.
                        if (wartosc >= doS) setDoS(Math.min(wartosc + 0.1, dlugoscS))
                      }}
                      className="w-full"
                    />
                  )}
                </Field>

                <Field label={`Do ${doS.toFixed(1)} s`} hint="Koniec wybranego fragmentu.">
                  {(id) => (
                    <input
                      id={id}
                      type="range"
                      min={0}
                      max={dlugoscS}
                      step={0.1}
                      value={doS}
                      onChange={(event) => {
                        const wartosc = Number(event.target.value)
                        setDoS(wartosc)
                        if (wartosc <= odS) setOdS(Math.max(wartosc - 0.1, 0))
                      }}
                      className="w-full"
                    />
                  )}
                </Field>

                <p className="text-xs text-ink-muted">
                  Zostanie {(doS - odS).toFixed(1)} s z {dlugoscS.toFixed(1)} s.
                  {pingPong ? ` Z pętlą wyjdzie ${((doS - odS) * 2).toFixed(1)} s.` : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">Cały klip, {dlugoscS.toFixed(1)} s.</p>
            )}
          </div>
        )}

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
                onChange={(event) =>
                    setTargetMb(
                      zacisnij(Number(event.target.value), {
                        min: 0.5,
                        max: 50,
                        domyslna: 4,
                      }),
                    )
                  }
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
                  ...(przycinaj
                    ? [
                        {
                          kind: 'trim',
                          startMs: Math.round(odS * 1000),
                          endMs: Math.round(doS * 1000),
                        },
                      ]
                    : []),
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


/**
 * Powtórzenie kadru z zapisanego numeru losowania.
 *
 * Bez tego numer pokazywany pod każdym kafelkiem nie prowadził donikąd,
 * a dymek radził go zapisać, obiecując funkcję, której nie było. To jest
 * warunek zamknięcia etapu E2 ze `SPEC.md` §12: „z UI da się powtórzyć kadr
 * z zapisanego seeda".
 */
function PoprawKadr({
  orderId,
  asset,
  disabled,
  wartosc,
  ustawWartosc,
  wyslij,
  zajety,
}: {
  orderId: string
  asset: Asset
  disabled: boolean
  wartosc: string | null
  ustawWartosc: (v: string) => void
  wyslij: (body: Record<string, unknown>) => Promise<void>
  zajety: boolean
}) {
  // Opis i przeznaczenie wracają z metadanych kadru — nie trzeba pytać bazy.
  const metadane = odczytajMetadane(asset.metadataJson)
  const opis = wartosc ?? metadane.promptEn ?? ''
  const purpose = metadane.purpose ?? 'square'
  const preset = OUTPUT_PRESETS[purpose as keyof typeof OUTPUT_PRESETS] ?? OUTPUT_PRESETS.square

  function zadanie(seeds: number[]): Record<string, unknown> {
    return {
      kind: 'image_generate',
      orderId,
      promptEn: opis,
      purpose,
      width: preset.generate.width,
      height: preset.generate.height,
      seeds,
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded border border-line p-2">
      <h4 className="flex items-baseline gap-1 text-sm font-medium text-ink">
        Popraw ten kadr
        <span className="text-xs font-normal text-ink-muted" title={FIELD_HINTS.seed}>
          nr {asset.seed}
        </span>
      </h4>

      <Field label="Opis sceny" hint="Zmień to, co ma wyjść inaczej. Reszta zostaje.">
        {(id) => (
          <TextArea id={id} value={opis} onChange={ustawWartosc} rows={5} maxLength={2000} />
        )}
      </Field>

      <Button
        variant="primary"
        disabled={disabled || zajety || opis.trim().length < 10 || asset.seed === null}
        onClick={() => void wyslij(zadanie([asset.seed ?? 0]))}
      >
        Ten sam numer, poprawiony opis
      </Button>

      <Button
        disabled={disabled || zajety || opis.trim().length < 10}
        onClick={() =>
          void wyslij(
            zadanie(Array.from({ length: 4 }, () => Math.floor(Math.random() * 2_147_483_647))),
          )
        }
      >
        Ten sam opis, nowe numery
      </Button>
    </section>
  )
}

/** Metadane kadru. Zapisujemy je sami, ale i tak sprawdzamy kształt. */
function odczytajMetadane(raw: string | null): { promptEn?: string; purpose?: string } {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const promptEn = Reflect.get(parsed, 'promptEn')
    const purpose = Reflect.get(parsed, 'purpose')
    return {
      promptEn: typeof promptEn === 'string' ? promptEn : undefined,
      purpose: typeof purpose === 'string' ? purpose : undefined,
    }
  } catch {
    // Uszkodzone metadane nie mogą wywrócić panelu — po prostu ich nie ma.
    return {}
  }
}
