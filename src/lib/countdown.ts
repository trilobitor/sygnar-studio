/**
 * Formatowanie odliczania do automatycznego wylogowania.
 *
 * Wydzielone z komponentu, żeby dało się to sprawdzić testem bez
 * uruchamiania przeglądarki — a formatowanie czasu to dokładnie ten rodzaj
 * kodu, w którym błąd o jedną sekundę siedzi latami niezauważony.
 */

/** Od ilu sekund licznik robi się czerwony i zaczyna być ogłaszany. */
export const IDLE_WARNING_SECONDS = 10

/**
 * Zwraca `m:ss` powyżej minuty, a poniżej samą liczbę sekund z jednostką.
 * „0:07" przy siedmiu sekundach czyta się gorzej niż „7 s".
 */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))

  if (safe < 60) return `${safe} s`

  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
