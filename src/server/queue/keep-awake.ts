import { spawn } from 'node:child_process'

import { logger } from '@/lib/logger'

/**
 * Blokada usypiania na czas zadania (SPEC §15, etap E7).
 *
 * Mac zasypiający w połowie ośmiominutowego zadania to jedno z ryzyk
 * z tabeli. `caffeinate -i` trzyma maszynę wybudzoną, dopóki proces żyje,
 * więc uruchamiamy go na start zadania i gasimy na koniec.
 *
 * Blokada dotyczy bezczynności, nie zamknięcia klapy — zamknięcie klapy
 * MacBooka i tak uśpi maszynę i tego nie obchodzimy.
 */



/**
 * Stan na `globalThis`, wzorem reszty projektu.
 *
 * Next w trybie deweloperskim przeładowuje moduły przy każdej zmianie —
 * zmienne modułowe wracały wtedy do zera, a poprzedni `caffeinate` zostawał
 * bez właściciela i trzymał maszynę wybudzoną w nieskończoność.
 */
const globalForCaffeine = globalThis as unknown as {
  studioCaffeinate?: ReturnType<typeof spawn> | null
  studioCaffeineHolders?: number
}

/** Gasi blokadę bezwarunkowo. Wołane z obsługi wyjścia procesu. */
export function zwolnijBlokade(): void {
  const proces = globalForCaffeine.studioCaffeinate
  if (proces !== null && proces !== undefined) proces.kill('SIGTERM')

  globalForCaffeine.studioCaffeinate = null
  globalForCaffeine.studioCaffeineHolders = 0
}

export function keepAwake(): () => void {
  globalForCaffeine.studioCaffeineHolders = (globalForCaffeine.studioCaffeineHolders ?? 0) + 1

  if (globalForCaffeine.studioCaffeinate == null) {
    try {
      globalForCaffeine.studioCaffeinate = spawn('/usr/bin/caffeinate', ['-i'], {
        shell: false,
        stdio: 'ignore',
      })
      globalForCaffeine.studioCaffeinate.on('error', () => {
        // Brak `caffeinate` nie jest powodem, żeby nie policzyć kadru.
        logger.warn('nie udało się zablokować usypiania')
        globalForCaffeine.studioCaffeinate = null
      })
    } catch {
      logger.warn('nie udało się zablokować usypiania')
      globalForCaffeine.studioCaffeinate = null
    }
  }

  let released = false

  return () => {
    if (released) return
    released = true

    const zostalo = (globalForCaffeine.studioCaffeineHolders ?? 1) - 1
    globalForCaffeine.studioCaffeineHolders = Math.max(0, zostalo)

    if (zostalo <= 0) zwolnijBlokade()
  }
}
