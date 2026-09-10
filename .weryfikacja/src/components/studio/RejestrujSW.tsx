'use client'

import { useEffect } from 'react'

/**
 * Rejestracja service workera. Bez niej Chrome i Edge nie proponują instalacji
 * panelu, a SPEC §44 wymaga PWA instalowalnej na laptopie grafika.
 *
 * Rejestrujemy wyłącznie po HTTPS (albo na localhoście, który przeglądarki
 * traktują jak bezpieczny). Po sieci tailnetu bez certyfikatu `navigator
 * .serviceWorker` w ogóle nie istnieje i wywołanie rzucałoby wyjątkiem.
 */
export function RejestrujSW(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const rejestracja = navigator.serviceWorker.register('/sw.js')

    // Nieudana rejestracja nie może psuć panelu — to funkcja dodatkowa.
    rejestracja.catch(() => {})
  }, [])

  return null
}
