/**
 * Rozpoznawanie poz, na których model myli anatomię.
 *
 * Wydzielone ze `scene-rules`, bo korzysta z tego okno briefu po stronie
 * przeglądarki — a komponent kliencki nie ma prawa sięgać do `server/`.
 * Turbopack odcinał dotąd resztę modułu i nic wrażliwego nie wyciekało, ale
 * wystarczyłby jeden import runtime'owy w `scene-rules`, żeby wciągnąć do
 * przeglądarki konfigurację serwera albo wywalić budowanie (SYG-110).
 */

/*
 * Pozy, na których model myli anatomię.
 *
 * Zmierzone na FLUX.2 klein 4B, po trzy próby na pozę, ten sam numer losowania
 * i te same ustawienia — zmieniany był wyłącznie opis pozy:
 *
 * - postać w powietrzu (wsad, skok): 3 z 3 kadrów z błędem — raz trzecia noga,
 *   raz brakująca ręka, raz zdublowana kończyna;
 * - ta sama postać stojąca, stopy na ziemi: 2 z 2 kadrów poprawne.
 *
 * Podniesienie kroków z 4 na 8 **nie pomogło** — obraz wyszedł ładniejszy, ale
 * trzecia noga została. To nie jest kwestia budżetu próbkowania ani opisu
 * sceny, tylko tego, że rozrzucone kończyny w locie są dla modelu tej wielkości
 * najtrudniejszym możliwym przypadkiem.
 *
 * Nie blokujemy takiego briefu — czasem wyjdzie. Uprzedzamy, bo grafik ma
 * wiedzieć, że warto policzyć więcej podejść i przejrzeć je uważniej.
 */
const POZY_RYZYKOWNE = [
  'skok',
  'skacz',
  'wskakuj',
  'wyskok',
  'w powietrzu',
  'wsad',
  'lot',
  'lecąc',
  'leci',
  'unosi się',
  'biegn',
  'bieg ',
  'tańc',
  'taniec',
  'tańcu',
  'tancer',
  'salto',
  'fikoł',
  'kopnię',
  'rzut',
  'wrzuca',
  'wspina',
] as const

export function ryzykownaPoza(subject: string): boolean {
  const tekst = subject.toLowerCase()
  return POZY_RYZYKOWNE.some((slowo) => tekst.includes(slowo))
}
