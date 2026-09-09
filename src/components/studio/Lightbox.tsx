'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Asset } from '@/types/api'

/**
 * Podgląd na cały ekran, ze skalą 1:1.
 *
 * Podgląd w kolumnie środkowej skaluje kadr wyłącznie do wpasowania. Kadr
 * 1664 × 1248 oglądany na ~800 px szerokości to 48 % — a przy tej skali
 * interpolacja przeglądarki chowa dokładnie te wady, które generator robi
 * najczęściej: rozmyty detal, zdublowane palce, zniekształcony napis.
 * Bez skali 100 % grafik nie jest w stanie ocenić, czy kadr nadaje się
 * do oddania.
 *
 * Sterowanie: `F` albo dwuklik otwiera, `Escape` zamyka, `Z` przełącza skalę
 * wpasuj → 100 % → 200 %. Powyżej wpasowania kadr przesuwa się przeciąganiem
 * i kółkiem.
 */

type Skala = 'fit' | 1 | 2

const NASTEPNA: Record<string, Skala> = { fit: 1, '1': 2, '2': 'fit' }

export function Lightbox({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [skala, setSkala] = useState<Skala>('fit')
  const [naturalne, setNaturalne] = useState<{ w: number; h: number } | null>(null)
  const [przesuniecie, setPrzesuniecie] = useState({ x: 0, y: 0 })

  const ramka = useRef<HTMLDivElement>(null)
  const ciagnie = useRef<{ x: number; y: number } | null>(null)

  // Rozmiar ramki i to, czy trwa przeciąganie, trzymamy w stanie: czytanie
  // referencji w trakcie renderu daje wartość z poprzedniej klatki i nie
  // powoduje przerysowania, gdy się zmieni.
  const [ramkaPx, setRamkaPx] = useState<{ w: number; h: number } | null>(null)
  const [ciagniete, setCiagniete] = useState(false)

  /*
   * Element, do którego wraca focus po zamknięciu. Bez tego czytnik ekranu
   * po Escape lądował na początku dokumentu, a nie przy kadrze, od którego
   * grafik zaczął.
   */
  const wracaDo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    wracaDo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const element = ramka.current
    element?.focus()

    if (element !== null) {
      setRamkaPx({ w: element.clientWidth, h: element.clientHeight })
    }

    const obserwator = new ResizeObserver(([wpis]) => {
      if (wpis === undefined) return
      setRamkaPx({ w: wpis.contentRect.width, h: wpis.contentRect.height })
    })

    if (element !== null) obserwator.observe(element)

    return () => {
      obserwator.disconnect()
      wracaDo.current?.focus()
    }
  }, [])

  const przelacz = useCallback(() => {
    setSkala((biezaca) => NASTEPNA[String(biezaca)] ?? 'fit')
    setPrzesuniecie({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    function klawisz(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        przelacz()
      }
    }

    window.addEventListener('keydown', klawisz)
    return () => window.removeEventListener('keydown', klawisz)
  }, [onClose, przelacz])

  /** Skala wpasowania w procentach — do etykiety, żeby grafik wiedział, co widzi. */
  const procentWpasowania =
    naturalne === null || ramkaPx === null
      ? null
      : Math.round(Math.min(ramkaPx.w / naturalne.w, ramkaPx.h / naturalne.h, 1) * 100)

  const etykieta =
    skala === 'fit' ? `${String(procentWpasowania ?? 100)} %` : `${String(skala * 100)} %`

  const przesuwalne = skala !== 'fit'

  return (
    <div
      ref={ramka}
      role="dialog"
      aria-modal="true"
      aria-label={`Podgląd kadru na cały ekran, skala ${etykieta}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-surface-0 outline-none"
      onWheel={(event) => {
        if (!przesuwalne) return
        setPrzesuniecie((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }))
      }}
      onPointerDown={(event) => {
        if (!przesuwalne) return
        ciagnie.current = { x: event.clientX - przesuniecie.x, y: event.clientY - przesuniecie.y }
        setCiagniete(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const start = ciagnie.current
        if (start === null) return
        setPrzesuniecie({ x: event.clientX - start.x, y: event.clientY - start.y })
      }}
      onPointerUp={() => {
        ciagnie.current = null
        setCiagniete(false)
      }}
      style={{ cursor: przesuwalne ? (ciagniete ? 'grabbing' : 'grab') : 'default' }}
    >
      {/*
        Tło jest przyciskiem, a nie diwem z `onClick`: zamknięcie kliknięciem
        obok kadru musi być osiągalne także z klawiatury, a czytnik ekranu
        potrzebuje nazwy dla tej akcji.
      */}
      <button
        type="button"
        aria-label="Zamknij podgląd pełnoekranowy"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/files/${asset.id}`}
        alt="Kadr w podglądzie pełnoekranowym"
        onLoad={(event) =>
          setNaturalne({
            w: event.currentTarget.naturalWidth,
            h: event.currentTarget.naturalHeight,
          })
        }
        draggable={false}
        className={
          skala === 'fit'
            ? 'relative max-h-full max-w-full object-contain'
            : 'relative max-w-none'
        }
        style={
          skala === 'fit'
            ? undefined
            : {
                width: naturalne === null ? undefined : naturalne.w * skala,
                transform: `translate(${String(przesuniecie.x)}px, ${String(przesuniecie.y)}px)`,
              }
        }
      />

      {/* Etykieta skali: grafik musi wiedzieć, czy patrzy na piksele, czy na
          pomniejszenie, w którym wady i tak nie byłoby widać. */}
      <p className="pointer-events-none absolute bottom-4 left-4 text-xs text-ink-muted">
        {etykieta}
        <span className="ml-3">Z — skala · Escape — zamknij</span>
      </p>
    </div>
  )
}
