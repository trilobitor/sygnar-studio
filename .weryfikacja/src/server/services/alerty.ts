import { execFile } from 'node:child_process'

import { logger } from '@/lib/logger'
import { db } from '@/server/db/client'
import { loginEvents } from '@/server/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Powiadomienia macOS o wejściach do panelu.
 *
 * Panel stoi w internecie, więc log wejść bez alertu jest wart tyle, co
 * pamięć o zaglądaniu do niego. Alarmujemy w dwóch sytuacjach, obu
 * wskazujących na coś, czego właściciel nie zrobił sam:
 *
 * 1. Udane logowanie **z nieznanego dotąd miejsca** — codzienne wejścia
 *    z tego samego Maca są ciche, bo inaczej alert szybko staje się tłem
 *    i przestaje cokolwiek znaczyć. Wyciek hasła daje nowy adres, więc
 *    zadziała.
 * 2. Wyczerpanie limitu prób — ktoś zgaduje hasło.
 */

/** Nie częściej niż raz na godzinę z tego samego adresu — alert ma nie zalewać. */
const ODSTEP_MS = 60 * 60_000

const ostatnieOstrzezenie = new Map<string, number>()

function powiadom(tytul: string, tresc: string): void {
  // Cudzysłowy w treści zamykałyby napis AppleScriptu, więc uciekamy je,
  // a treść i tak składamy wyłącznie z wartości, które sami tworzymy.
  const bezpieczne = (s: string): string => s.replace(/[\\"]/g, '')

  execFile(
    'osascript',
    [
      '-e',
      `display notification "${bezpieczne(tresc)}" with title "Sygnar Studio" subtitle "${bezpieczne(tytul)}"`,
    ],
    (error) => {
      // Brak powiadomień nie może wywrócić logowania — to warstwa dodatkowa.
      if (error !== null) {
        logger.warn('nie udało się wyświetlić powiadomienia', { cause: error.message })
      }
    },
  )
}

/** Czy z tego miejsca ktoś już kiedyś wszedł. Pytanie zadajemy przed zapisem. */
function znaneMiejsce(clientHash: string): boolean {
  const wpis = db
    .select()
    .from(loginEvents)
    .where(and(eq(loginEvents.clientHash, clientHash), eq(loginEvents.outcome, 'ok')))
    .limit(1)
    .get()

  return wpis !== undefined
}

export function alertUdaneLogowanie(imie: string, clientHash: string): void {
  if (znaneMiejsce(clientHash)) return

  powiadom('Logowanie z nowego miejsca', `${imie} — pierwsze wejście z tego adresu`)
  logger.warn('logowanie z nieznanego dotąd adresu', { kto: imie, skrot: clientHash })
}

export function alertZgadywanieHasla(clientHash: string): void {
  const teraz = Date.now()
  const poprzednie = ostatnieOstrzezenie.get(clientHash) ?? 0

  if (teraz - poprzednie < ODSTEP_MS) return
  ostatnieOstrzezenie.set(clientHash, teraz)

  powiadom('Ktoś zgaduje hasło', `Wyczerpany limit prób z adresu ${clientHash.slice(0, 8)}`)
  logger.warn('wyczerpany limit prób logowania', { skrot: clientHash })
}
