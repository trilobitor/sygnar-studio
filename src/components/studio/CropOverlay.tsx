'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/primitives'
import { messageForCode } from '@/lib/messages'
import type { Asset, ErrorResponse } from '@/types/api'

/**
 * Zaznaczanie prostokąta do przycięcia, wprost na podglądzie.
 *
 * Cała rzecz dzieje się w przeglądarce — na serwer idą cztery liczby, a on
 * robi `sharp.extract()` w milisekundach. Rysowanie po obrazie nie kosztuje
 * Maca nic.
 *
 * Najtrudniejszy fragment to przeliczenie współrzędnych. Obraz jest pokazany
 * w `object-contain`, więc wewnątrz swojego pudełka bywa zwężony albo obniżony
 * o czarne pasy. Prostokąt zaznaczony na ekranie trzeba przeliczyć na piksele
 * **pliku**, a nie pudełka — inaczej wycinek byłby przesunięty o szerokość pasa.
 */

interface Prostokat {
  left: number
  top: number
  width: number
  height: number
}

/** Gdzie realnie leży obraz wewnątrz swojego pudełka i w jakiej skali. */
function polozenieObrazu(el: HTMLImageElement): {
  x: number
  y: number
  skala: number
} | null {
  /*
   * Obraz jeszcze niezdekodowany ma `naturalWidth` równe zero. Dzielenie
   * dawało wtedy `Infinity`, a `0 * Infinity` w wyliczeniu przesunięcia —
   * `NaN`, który szedł dalej aż do etykiety z wymiarami. Myszą nie dało się
   * tego zobaczyć: zanim grafik narysuje prostokąt, obraz jest już gotowy.
   * Klawiatura trafia w to okno za pierwszym naciśnięciem strzałki.
   */
  if (el.naturalWidth === 0 || el.naturalHeight === 0) return null

  const pudelko = el.getBoundingClientRect()
  const skala = Math.min(pudelko.width / el.naturalWidth, pudelko.height / el.naturalHeight)

  return {
    x: pudelko.left + (pudelko.width - el.naturalWidth * skala) / 2,
    y: pudelko.top + (pudelko.height - el.naturalHeight * skala) / 2,
    skala,
  }
}

export function CropOverlay({
  asset,
  obraz,
  onClose,
  onCropped,
}: {
  asset: Asset
  /** Element obrazu w podglądzie — z niego bierzemy skalę i położenie. */
  obraz: HTMLImageElement | null
  onClose: () => void
  onCropped: () => void
}) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [teraz, setTeraz] = useState<{ x: number; y: number } | null>(null)
  /*
   * Czy wskaźnik jest w tej chwili wciśnięty.
   *
   * Osobno od `start`, bo `start` musi przeżyć puszczenie przycisku — z niego
   * i z `teraz` bierze się prostokąt, który pojedzie do przycięcia. Bez tej
   * flagi ramka chodziła za kursorem także po puszczeniu, więc „Przytnij"
   * tło inny prostokąt, niż grafik narysował (defekt SYG-002).
   */
  const [rysuje, setRysuje] = useState(false)
  const [tnie, setTnie] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  /*
   * Punkty trzymamy we współrzędnych **okna**, nie warstwy. Dzięki temu
   * przeliczenie na piksele pliku potrzebuje wyłącznie elementu obrazu,
   * a nie prostokąta warstwy — którego i tak nie wolno czytać z referencji
   * w trakcie renderu.
   */
  /** Zaznaczenie we współrzędnych okna — do narysowania ramki. */
  const ramka =
    start === null || teraz === null
      ? null
      : {
          left: Math.min(start.x, teraz.x),
          top: Math.min(start.y, teraz.y),
          width: Math.abs(teraz.x - start.x),
          height: Math.abs(teraz.y - start.y),
        }

  /** To samo zaznaczenie przeliczone na piksele pliku źródłowego. */
  function prostokatWPliku(): Prostokat | null {
    if (ramka === null || obraz === null) return null

    const polozenie = polozenieObrazu(obraz)
    if (polozenie === null) return null

    const { x, y, skala } = polozenie

    const left = Math.round((ramka.left - x) / skala)
    const top = Math.round((ramka.top - y) / skala)
    const width = Math.round(ramka.width / skala)
    const height = Math.round(ramka.height / skala)

    // Docinamy do granic obrazu: przy szybkim ruchu myszy kursor wyjeżdża poza
    // kadr, a serwer takie zaznaczenie i tak by odrzucił.
    const l = Math.max(0, Math.min(left, obraz.naturalWidth - 1))
    const t = Math.max(0, Math.min(top, obraz.naturalHeight - 1))

    return {
      left: l,
      top: t,
      width: Math.min(width, obraz.naturalWidth - l),
      height: Math.min(height, obraz.naturalHeight - t),
    }
  }

  const wPliku = prostokatWPliku()
  const zaMale = wPliku !== null && (wPliku.width < 100 || wPliku.height < 100)

  /*
   * Obsługa z klawiatury (SYG-010).
   *
   * Prostokąt rysował wyłącznie wskaźnik, więc osoba pracująca z klawiatury
   * nie mogła przyciąć kadru w ogóle — „Przytnij" zostawał wyszarzony na
   * zawsze, bo bez zaznaczenia `wPliku` jest puste.
   *
   * Model jest pozycyjny, nie gestowy: pierwsza strzałka zakłada zaznaczenie
   * na środku kadru, strzałki je przesuwają, Alt ze strzałką zmienia rozmiar.
   * Przy zmianie rozmiaru rusza się sam prawy dolny róg, bo lewy górny
   * wyznacza początek wycinka i grafik trzyma go w pamięci.
   */
  const KROK = 16
  const KROK_DOKLADNY = 2

  /*
   * Nasłuch na oknie, nie na warstwie rysowania. Warstwa jest z definicji
   * nieinteraktywna (`role="presentation"`) i reguła dostępności słusznie
   * protestuje przeciw wieszaniu na niej klawiatury. Nakładka kadrowania
   * przykrywa cały podgląd, więc strzałki i tak nie mają tu innego znaczenia
   * — dokładnie tak działają pozostałe skróty w tej aplikacji.
   */
  useEffect(() => {
    function klawiszem(event: KeyboardEvent): void {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return

      const cel = event.target
      if (
        cel instanceof HTMLElement &&
        (cel.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cel.tagName))
      ) {
        return
      }

      /*
       * Faza przechwytywania i zatrzymanie propagacji, bo strzałki mają już
       * właściciela: galeria przełącza nimi kadry. Bez tego pierwsze
       * naciśnięcie zmieniało zaznaczony kadr i zamykało kadrowanie, zamiast
       * założyć wycinek — nakładka przykrywa ekran, więc dopóki jest otwarta,
       * strzałki należą do niej.
       */
      event.preventDefault()
      event.stopPropagation()

      const pudelko = obraz?.getBoundingClientRect()
      if (pudelko === undefined) return

      // Pierwsza strzałka zakłada zaznaczenie na środku, sześćdziesiąt procent
      // kadru — na tyle duże, żeby było co przesuwać, i na tyle małe, żeby od
      // razu było widać, że to wycinek, a nie całość.
      if (start === null || teraz === null) {
        const w = pudelko.width * 0.6
        const h = pudelko.height * 0.6

        setStart({
          x: pudelko.left + (pudelko.width - w) / 2,
          y: pudelko.top + (pudelko.height - h) / 2,
        })
        setTeraz({
          x: pudelko.left + (pudelko.width + w) / 2,
          y: pudelko.top + (pudelko.height + h) / 2,
        })
        return
      }

      const krok = event.shiftKey ? KROK_DOKLADNY : KROK
      const dx = event.key === 'ArrowLeft' ? -krok : event.key === 'ArrowRight' ? krok : 0
      const dy = event.key === 'ArrowUp' ? -krok : event.key === 'ArrowDown' ? krok : 0

      if (event.altKey) {
        setTeraz((punkt) => (punkt === null ? null : { x: punkt.x + dx, y: punkt.y + dy }))
        return
      }

      setStart((punkt) => (punkt === null ? null : { x: punkt.x + dx, y: punkt.y + dy }))
      setTeraz((punkt) => (punkt === null ? null : { x: punkt.x + dx, y: punkt.y + dy }))
    }

    window.addEventListener('keydown', klawiszem, true)
    return () => window.removeEventListener('keydown', klawiszem, true)
  }, [obraz, start, teraz])

  async function przytnij(): Promise<void> {
    if (wPliku === null) return

    setTnie(true)
    setProblem(null)

    try {
      const odpowiedz = await fetch(`/api/assets/${asset.id}/kadruj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wPliku),
      })

      if (!odpowiedz.ok) {
        const blad = (await odpowiedz.json()) as ErrorResponse
        setProblem(messageForCode(blad.errorCode))
        return
      }

      onCropped()
      onClose()
    } catch {
      setProblem('Nie udało się przyciąć kadru. Spróbuj jeszcze raz.')
    } finally {
      setTnie(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20">
      {/* Warstwa łapiąca ciągnięcie. Kursor krzyżykiem, żeby było widać,
          że tu się rysuje, a nie klika. */}
      <div
        role="presentation"
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={(event) => {
          const punkt = { x: event.clientX, y: event.clientY }

          setStart(punkt)
          setTeraz(punkt)
          setRysuje(true)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!rysuje) return
          setTeraz({ x: event.clientX, y: event.clientY })
        }}
        onPointerUp={(event) => {
          setRysuje(false)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        /*
         * `pointercancel` leci, gdy system przejmie wskaźnik — gest przewijania
         * na gładziku albo drugi palec na ekranie dotykowym. Bez tego `rysuje`
         * zostawałoby włączone na zawsze. `lostpointercapture` domyka przypadki,
         * w których przeglądarka zwolni przechwycenie sama.
         */
        onPointerCancel={() => setRysuje(false)}
        onLostPointerCapture={() => setRysuje(false)}
      />

      {ramka !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed border-2 border-ink shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{
            left: ramka.left,
            top: ramka.top,
            width: ramka.width,
            height: ramka.height,
          }}
        />
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 bg-surface-0/90 px-3 py-2">
        <p className="text-xs tabular-nums text-ink-muted">
          {wPliku === null
            ? // Klawisze wymienione wprost: bez tego obsługa z klawiatury
              // istnieje, ale nikt się o niej nie dowie.
              'Zaznacz prostokąt na kadrze albo naciśnij strzałkę.'
            : `${String(wPliku.width)} × ${String(wPliku.height)} px${zaMale ? ' — za mały wycinek' : ''}`}
        </p>

        <p className="text-xs text-ink-muted">
          strzałki przesuwają · Alt ze strzałką zmienia rozmiar · Shift dokładniej
        </p>

        {problem !== null && (
          <p role="alert" className="text-xs text-danger">
            {problem}
          </p>
        )}

        <span className="flex gap-2">
          <Button onClick={onClose}>Anuluj</Button>
          <Button
            variant="primary"
            disabled={wPliku === null || zaMale || tnie}
            onClick={() => void przytnij()}
          >
            {tnie ? 'Tnę…' : 'Przytnij'}
          </Button>
        </span>
      </div>
    </div>
  )
}
