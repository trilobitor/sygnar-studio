'use client'

import { useState } from 'react'

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
} {
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

    const { x, y, skala } = polozenieObrazu(obraz)

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
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (start === null) return
          setTeraz({ x: event.clientX, y: event.clientY })
        }}
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
        <p className="text-xs text-ink-muted">
          {wPliku === null
            ? 'Zaznacz prostokąt na kadrze.'
            : `${String(wPliku.width)} × ${String(wPliku.height)} px${zaMale ? ' — za mały wycinek' : ''}`}
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
