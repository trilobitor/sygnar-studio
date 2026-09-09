import { spawn, type ChildProcess } from 'node:child_process'

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

let holder: ChildProcess | null = null
let holders = 0

export function keepAwake(): () => void {
  holders += 1

  if (holder === null) {
    try {
      holder = spawn('/usr/bin/caffeinate', ['-i'], { shell: false, stdio: 'ignore' })
      holder.on('error', () => {
        // Brak `caffeinate` nie jest powodem, żeby nie policzyć kadru.
        logger.warn('nie udało się zablokować usypiania')
        holder = null
      })
    } catch {
      logger.warn('nie udało się zablokować usypiania')
      holder = null
    }
  }

  let released = false

  return () => {
    if (released) return
    released = true
    holders -= 1

    if (holders <= 0 && holder !== null) {
      holder.kill('SIGTERM')
      holder = null
      holders = 0
    }
  }
}
