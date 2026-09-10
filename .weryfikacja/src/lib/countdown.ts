/**
 * Formatowanie odliczania do automatycznego wylogowania.
 *
 * Wydzielone z komponentu, żeby dało się to sprawdzić testem bez
 * uruchamiania przeglądarki — a formatowanie czasu to dokładnie ten rodzaj
 * kodu, w którym błąd o jedną sekundę siedzi latami niezauważony.
 */

/**
 * Od ilu sekund licznik w ogóle się pokazuje.
 *
 * Przez większość czasu jest ukryty — odliczanie na oczach przez pół godziny
 * rozprasza i niczego nie wnosi. Wraca na ostatnią minutę, żeby wylogowanie
 * nie zaskoczyło kogoś w połowie pisania briefu.
 */
export const COUNTDOWN_VISIBLE_SECONDS = 60

/** Od ilu sekund licznik jest ogłaszany czytnikowi ekranu. */
/*
 * Trzydzieści sekund, nie dziesięć.
 *
 * Czytnik ekranu ogłasza komunikat dopiero po dokończeniu bieżącej wypowiedzi,
 * a osoba niewidoma potrzebuje jeszcze chwili na zrozumienie i reakcję.
 * Dziesięć sekund to za mało, żeby zdążyć cokolwiek zrobić przed wylogowaniem.
 */
export const IDLE_WARNING_SECONDS = 30

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
