'use client'

import { useEffect, useRef, useState } from 'react'

import { Button, EmptyState, Field, Hint, Select, Skrot, TextArea } from '@/components/ui/primitives'
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
  /*
   * Slot startowy bierzemy z metadanych kadru, nie ze stałej.
   *
   * Kadr powstał dla konkretnego przeznaczenia i ma je zapisane — panel
   * proponował mimo to zawsze `services-wide`, więc grafik musiał przestawiać
   * listę przy każdym eksporcie albo, gorzej, nie zauważał i oddawał plik
   * w złym wymiarze.
   *
   * Komponent jest remountowany przy zmianie zaznaczenia (`key` w
   * `StudioScreen`), więc wartość początkowa liczy się na nowo dla każdego
   * kadru.
   */
  const [purpose, setPurpose] = useState<string>(
    () => odczytajMetadane(asset?.metadataJson ?? null).purpose ?? 'services-wide',
  )
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
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

          {/* Słowniczek przeznaczeń był napisany w `OUTPUT_PRESETS`, ale
              nigdzie niepokazany — grafik wybierał slot po samej nazwie. */}
          <p className="-mt-2 text-xs text-ink-muted">{preset.hint}</p>

          {/* Cztery dane, nie zdanie. Grafik czyta je przy każdym eksporcie,
              czyli kilkanaście razy dziennie, a ze zdania musiał je za każdym
              razem wyłuskać. Znalezisko UX-003 z audytu 10.09.2026. */}
          <dl className="flex flex-col gap-1 rounded border border-line bg-surface-2 px-3 py-2 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Wymiary</dt>
              <dd className="tabular-nums text-ink">
                {preset.deliver.width} × {preset.deliver.height} px
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Waga najwyżej</dt>
              <dd className="tabular-nums text-ink">{preset.maxWeightKb} KB</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Formaty</dt>
              {/* Wersaliki nakładamy na same nazwy formatów: `.toUpperCase()`
                  na całości zamieniał polski spójnik „i" na „I". */}
              <dd className="text-ink">
                {preset.formats.map((f) => f.toUpperCase()).join(' i ')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="flex items-center text-ink-muted">
                Jakość
                <Hint text="Dobieramy ją sami: schodzimy z jakością tak długo, aż plik zmieści się w wadze. Grafik nie ustawia jej ręcznie." />
              </dt>
              <dd className="text-ink">dobierana sama</dd>
            </div>
          </dl>

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
                className="w-full rounded border border-field bg-surface-2 px-3 py-2 text-sm"
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

  /**
   * Zadanie generowania z parametrami tego kadru.
   *
   * `ile` bez `seeds` znaczy „wylosuj tyle numerów na serwerze". Losowania nie
   * robimy w przeglądarce: numer jest jedyną rzeczą pozwalającą odtworzyć kadr
   * i nie może zależeć od tego, który przycisk kliknięto.
   */
  function zadanie(
    tekst: string,
    wybor: { seeds: number[] } | { ile: number },
  ): Record<string, unknown> {
    return {
      kind: 'image_generate',
      orderId,
      promptEn: tekst,
      purpose,
      width: preset.generate.width,
      height: preset.generate.height,
      ...('seeds' in wybor ? { seeds: wybor.seeds } : { variants: wybor.ile }),
    }
  }

  /*
   * Trzy przyciski iteracji to oś tej pracy — grafik klika je dziesiątki razy
   * dziennie, a różnią się przestawieniem tych samych trzech słów. Skróty są
   * pozycyjne (1, 2, 3), nie mnemoniczne: „ten sam numer" i „ten sam opis"
   * zaczynają się tak samo, więc każda litera byłaby zgadywanką.
   *
   * Jedna lista obsługuje i przyciski, i klawiaturę — inaczej skrót mógłby
   * odpalić akcję, której przycisk jest właśnie wyszarzony. Znalezisko UX-006.
   */
  const wolno = !disabled && !zajety
  const opisGotowy = opis.trim().length >= 10
  const akcje = [
    {
      klawisz: '1',
      etykieta: 'Ten sam numer, nowy opis',
      opis: 'Ten sam kadr, poprawiony opis',
      glowna: true,
      widoczna: true,
      czynna: wolno && opisGotowy && asset.seed !== null,
      uruchom: () => void wyslij(zadanie(opis, { seeds: [asset.seed ?? 0] })),
    },
    {
      klawisz: '2',
      etykieta: 'Nowe numery, ten sam opis',
      opis: 'Cztery nowe kadry z tego samego opisu',
      glowna: false,
      widoczna: true,
      czynna: wolno && opisGotowy,
      uruchom: () => void wyslij(zadanie(opis, { ile: 4 })),
    },
    {
      /*
       * Powtórzenie bez żadnej zmiany: ten sam numer i opis zapisany przy
       * kadrze, nie ten z pola wyżej. Służy do sprawdzenia, czy stacja daje
       * ten sam wynik — na przykład po aktualizacji generatora.
       */
      klawisz: '3',
      etykieta: 'Powtórz bez zmian',
      opis: 'Ten sam numer i ten sam opis, do sprawdzenia stacji',
      glowna: false,
      widoczna: metadane.promptEn !== undefined && asset.seed !== null,
      czynna: wolno,
      uruchom: () =>
        void wyslij(zadanie(metadane.promptEn ?? '', { seeds: [asset.seed ?? 0] })),
    },
  ]

  /*
   * Nasłuch czyta akcje przez `ref`, a nie z zamknięcia: lista powstaje na nowo
   * przy każdym renderze, więc w zależnościach efektu kazałaby przepinać
   * zdarzenie po każdym naciśnięciu klawisza w opisie sceny.
   */
  const akcjeRef = useRef(akcje)
  useEffect(() => {
    akcjeRef.current = akcje
  })

  useEffect(() => {
    function klawisz(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

      const cel = event.target
      if (
        cel instanceof HTMLElement &&
        (cel.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cel.tagName))
      ) {
        return
      }

      /*
       * Otwarte okno modalne zabiera wszystko. Bez tego „2" naciśnięte przy
       * otwartym briefie puszczałoby generowanie w tle, a grafik zobaczyłby
       * cztery kadry, o które nie prosił.
       */
      if (document.querySelector('[role="dialog"]') !== null) return

      const akcja = akcjeRef.current.find((a) => a.klawisz === event.key)
      if (akcja === undefined || !akcja.widoczna || !akcja.czynna) return
      event.preventDefault()
      akcja.uruchom()
    }

    window.addEventListener('keydown', klawisz)
    return () => window.removeEventListener('keydown', klawisz)
  }, [])

  return (
    <section className="flex flex-col gap-2 rounded border border-line p-2">
      {/*
        Nagłówek i numer jeden pod drugim, nie obok siebie. W kolumnie szerokiej
        na 288 px oba łamały się na dwie linijki i stały jak dwie kolumny tabeli.
      */}
      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Popraw ten kadr
      </h4>
      <p className="-mt-1 text-xs tabular-nums text-ink-muted" title={FIELD_HINTS.seed}>
        numer losowania {asset.seed}
      </p>

      <Field label="Opis sceny" hint="Zmień to, co ma wyjść inaczej. Reszta zostaje.">
        {(id) => (
          <TextArea
            id={id}
            value={opis}
            onChange={ustawWartosc}
            rows={5}
            maxLength={2000}
            lang="en"
            /*
             * ⌘↵ prosto z opisu sceny. Bez tego grafik, który właśnie poprawił
             * opis, musiałby najpierw wyjść z pola, żeby cyfrowy skrót zadziałał
             * — a to dokładnie ten moment, w którym chce puścić generowanie.
             */
            naKlawisz={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                const glowna = akcje[0]
                if (glowna !== undefined && glowna.czynna) {
                  event.preventDefault()
                  glowna.uruchom()
                }
              }
            }}
          />
        )}
      </Field>

      {akcje.map((akcja) =>
        akcja.widoczna ? (
          <Button
            key={akcja.klawisz}
            variant={akcja.glowna ? 'primary' : 'ghost'}
            disabled={!akcja.czynna}
            title={`${akcja.opis} — klawisz ${akcja.klawisz}`}
            onClick={akcja.uruchom}
          >
            {akcja.etykieta}
            <Skrot klawisz={akcja.klawisz} />
          </Button>
        ) : null,
      )}
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
