'use client'

import { useState } from 'react'

import {
  Button,
  Dialog,
  Field,
  Hint,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui/primitives'
import {
  ANGLE_LABELS,
  FIELD_HINTS,
  LIGHTING_LABELS,
  messageForCode,
  odmiana,
  SHOT_LABELS,
  STYLE_LABELS,
  zacisnij,
} from '@/lib/messages'
import { OUTPUT_PRESETS, PURPOSE_KEYS } from '@/lib/output-presets'
import type { Brief } from '@/lib/schemas'
import type { ErrorResponse, PromptResponse } from '@/types/api'

/**
 * Okno briefu (SPEC §10).
 *
 * Osobne okno modalne, nie panel wciśnięty w bok — brief jest głównym aktem
 * pracy grafika. Wymagany jest wyłącznie punkt pierwszy; reszta pusta oznacza
 * wartości domyślne, a aplikacja wypisuje jawnie, co uzupełniła za grafika.
 */

type Step = 'brief' | 'prompt'

const PURPOSE_OPTIONS = PURPOSE_KEYS.map((key) => ({
  value: key,
  label: OUTPUT_PRESETS[key].label,
}))

function toOptions(labels: Record<string, string>): { value: string; label: string }[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export function BriefDialog({
  open,
  orderId,
  brief,
  disabled,
  onClose,
  onQueued,
}: {
  open: boolean
  orderId: string
  /**
   * Ostatni brief tego zlecenia albo `null`.
   *
   * Makieta zapisywała się do bazy i wracała w odpowiedzi API, ale nikt jej
   * stamtąd nie odczytywał — grafik po ponownym otwarciu okna zastawał puste
   * pola i przepisywał wszystko od zera. Wartości startowe biorą się stąd.
   */
  brief: Brief | null
  disabled: boolean
  onClose: () => void
  onQueued: () => void
}) {
  const [step, setStep] = useState<Step>('brief')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  const [subject, setSubject] = useState(brief?.subject ?? '')
  const [purpose, setPurpose] = useState<string>(brief?.purpose ?? 'services-wide')
  const [style, setStyle] = useState(brief?.style ?? '')
  const [timeOfDay, setTimeOfDay] = useState(brief?.timeOfDay ?? '')
  const [mood, setMood] = useState(brief?.mood ?? '')
  const [shot, setShot] = useState(brief?.shot ?? '')
  const [angle, setAngle] = useState(brief?.angle ?? '')
  const [lighting, setLighting] = useState(brief?.lighting ?? '')
  const [place, setPlace] = useState(brief?.place ?? '')
  const [colors, setColors] = useState(brief?.colors ?? '')
  const [textOnImage, setTextOnImage] = useState(brief?.textOnImage ?? '')
  const [avoid, setAvoid] = useState(brief?.avoid ?? '')
  const [variants, setVariants] = useState(4)

  const [promptEn, setPromptEn] = useState('')
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [needsTranslation, setNeedsTranslation] = useState(false)

  const preset = OUTPUT_PRESETS[purpose as keyof typeof OUTPUT_PRESETS]

  function buildBrief(): Record<string, unknown> {
    const optional = (value: string): string | undefined =>
      value.length > 0 ? value : undefined

    return {
      subject,
      purpose,
      style: optional(style),
      timeOfDay: optional(timeOfDay),
      mood: optional(mood),
      shot: optional(shot),
      angle: optional(angle),
      lighting: optional(lighting),
      place: optional(place),
      colors: optional(colors),
      textOnImage: optional(textOnImage),
      avoid: optional(avoid),
      variants,
    }
  }

  async function requestPrompt(): Promise<void> {
    setBusy(true)
    setProblem(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBrief()),
      })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        // Awaria warstwy promptowej nie blokuje generowania — przechodzimy
        // do kroku z promptem, tyle że pustym i do ręcznego wpisania.
        setProblem(messageForCode(error.errorCode))
        setPromptEn('')
        setAssumptions([])
        // Zerowane razem z promptem: bez tego ostrzeżenie „opis poszedł bez
        // tłumaczenia" zostawało z poprzedniej próby i dotyczyło tekstu,
        // którego już nie ma.
        setNeedsTranslation(false)
        setStep('prompt')
        return
      }

      const data = (await response.json()) as PromptResponse
      setPromptEn(data.promptEn)
      setAssumptions(data.assumptions)
      setNeedsTranslation(data.needsTranslation)
      setStep('prompt')
    } catch {
      setProblem(messageForCode('PROMPT_SERVICE_FAILED'))
      setStep('prompt')
    } finally {
      setBusy(false)
    }
  }

  async function startGeneration(): Promise<void> {
    setBusy(true)
    setProblem(null)

    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'image_generate',
          orderId,
          promptEn,
          purpose,
          width: preset.generate.width,
          height: preset.generate.height,
          seeds: Array.from({ length: variants }, () =>
            Math.floor(Math.random() * 2_147_483_647),
          ),
        }),
      })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        setProblem(messageForCode(error.errorCode))
        return
      }

      onQueued()
      onClose()
      setStep('brief')
    } catch {
      setProblem('Nie udało się wysłać zadania. Sprawdź połączenie i spróbuj jeszcze raz.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={step === 'brief' ? 'Nowy brief' : 'Zanim ruszymy'}
      onClose={onClose}
      footer={
        step === 'brief' ? (
          <>
            <span className="mr-auto flex items-baseline text-sm text-ink-muted">
              <label htmlFor="variants">Liczba podejść</label>
              <Hint text={FIELD_HINTS.variants} />
            </span>
            <input
              id="variants"
              type="number"
              min={1}
              max={8}
              value={variants}
              onChange={(event) =>
                setVariants(
                  zacisnij(Math.round(Number(event.target.value)), {
                    min: 1,
                    max: 8,
                    domyslna: 4,
                  }),
                )
              }
              className="w-16 rounded border border-line bg-surface-2 px-2 py-1 text-sm"
            />
            <Button
              variant="primary"
              disabled={disabled || busy || subject.trim().length < 3}
              onClick={() => void requestPrompt()}
            >
              {busy ? 'Przygotowuję opis…' : 'Dalej'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep('brief')}>Wróć do briefu</Button>
            <Button
              variant="primary"
              disabled={disabled || busy || promptEn.trim().length < 10}
              onClick={() => void startGeneration()}
            >
              {busy
                ? 'Wysyłam…'
                : `Policz ${variants} ${odmiana(variants, ['podejście', 'podejścia', 'podejść'])}`}
            </Button>
          </>
        )
      }
    >
      {step === 'brief' ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Co ma być na obrazie"
            hint={FIELD_HINTS.subject}
            counter={`${subject.length}/500`}
          >
            {(id) => (
              <TextArea
                id={id}
                value={subject}
                onChange={setSubject}
                rows={4}
                maxLength={500}
                placeholder="Puste wnętrze kancelarii późnym popołudniem, dębowe biurko, skórzany fotel"
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Przeznaczenie" hint={FIELD_HINTS.purpose}>
              {(id) => (
                <Select id={id} value={purpose} onChange={setPurpose} options={PURPOSE_OPTIONS} />
              )}
            </Field>

            <Field label="Styl" hint={FIELD_HINTS.style}>
              {(id) => (
                <Select
                  id={id}
                  value={style}
                  onChange={setStyle}
                  options={toOptions(STYLE_LABELS)}
                  allowEmpty
                />
              )}
            </Field>

            <Field label="Pora dnia" hint={FIELD_HINTS.timeOfDay} counter={`${timeOfDay.length}/100`}>
              {(id) => (
                <TextInput
                  id={id}
                  value={timeOfDay}
                  onChange={setTimeOfDay}
                  maxLength={100}
                  placeholder="późne popołudnie"
                />
              )}
            </Field>

            <Field label="Nastrój" hint={FIELD_HINTS.mood} counter={`${mood.length}/100`}>
              {(id) => (
                <TextInput
                  id={id}
                  value={mood}
                  onChange={setMood}
                  maxLength={100}
                  placeholder="spokojny, skupiony"
                />
              )}
            </Field>
          </div>

          <p className="text-xs text-ink-muted">
            Kadr wyjdzie {preset.deliver.width} × {preset.deliver.height} pikseli.
            Puste pola uzupełnimy sensownymi wartościami i wypiszemy je na następnym ekranie.
          </p>

          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            aria-expanded={showMore}
            className="self-start text-sm text-accent"
          >
            {showMore ? '− Mniej szczegółów' : '+ Więcej szczegółów'}
          </button>

          {showMore && (
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-4">
              <Field label="Ujęcie" hint={FIELD_HINTS.shot}>
                {(id) => (
                  <Select
                    id={id}
                    value={shot}
                    onChange={setShot}
                    options={toOptions(SHOT_LABELS)}
                    allowEmpty
                  />
                )}
              </Field>

              <Field label="Z jakiej wysokości" hint={FIELD_HINTS.angle}>
                {(id) => (
                  <Select
                    id={id}
                    value={angle}
                    onChange={setAngle}
                    options={toOptions(ANGLE_LABELS)}
                    allowEmpty
                  />
                )}
              </Field>

              <Field label="Światło" hint={FIELD_HINTS.lighting}>
                {(id) => (
                  <Select
                    id={id}
                    value={lighting}
                    onChange={setLighting}
                    options={toOptions(LIGHTING_LABELS)}
                    allowEmpty
                  />
                )}
              </Field>

              <Field label="Kolory" hint={FIELD_HINTS.colors} counter={`${colors.length}/150`}>
                {(id) => (
                  <TextInput id={id} value={colors} onChange={setColors} maxLength={150} />
                )}
              </Field>

              <Field label="Miejsce" hint={FIELD_HINTS.place} counter={`${place.length}/300`}>
                {(id) => <TextInput id={id} value={place} onChange={setPlace} maxLength={300} />}
              </Field>

              <Field
                label="Tekst na obrazie"
                hint={FIELD_HINTS.textOnImage}
                counter={`${textOnImage.length}/60`}
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={textOnImage}
                    onChange={setTextOnImage}
                    maxLength={60}
                    placeholder="OTWARTE"
                  />
                )}
              </Field>

              <div className="col-span-2">
                <Field label="Czego unikać" hint={FIELD_HINTS.avoid} counter={`${avoid.length}/300`}>
                  {(id) => (
                    <TextArea id={id} value={avoid} onChange={setAvoid} rows={2} maxLength={300} />
                  )}
                </Field>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {problem !== null && (
            <p role="alert" className="rounded border border-danger bg-danger/10 px-3 py-2 text-sm">
              {problem}
            </p>
          )}

          {needsTranslation && (
            <p className="rounded border border-accent bg-accent/10 px-3 py-2 text-sm">
              Opis sceny złożyliśmy z Twoich odpowiedzi, ale to, co zostało wpisane
              w polu {'\u201E'}Co ma być na obrazie{'\u201D'}, jest po polsku. Model rysuje
              z angielskiego — przepisz ten fragment poniżej, a resztę zostaw.
            </p>
          )}

          {assumptions.length > 0 && (
            <div className="rounded border border-line bg-surface-2 px-3 py-2">
              <p className="mb-1 text-sm text-ink">Co uzupełniliśmy za Ciebie:</p>
              <ul className="list-disc pl-5 text-sm text-ink-muted">
                {assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          )}

          <Field
            label="Opis, który pójdzie do generowania"
            hint="To jest wersja angielska. Możesz ją poprawić — zmiany zadziałają od razu."
            counter={`${promptEn.length}/2000`}
          >
            {(id) => (
              <TextArea id={id} value={promptEn} onChange={setPromptEn} rows={8} maxLength={2000} />
            )}
          </Field>
        </div>
      )}
    </Dialog>
  )
}
