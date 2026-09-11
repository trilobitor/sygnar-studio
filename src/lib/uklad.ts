/**
 * Arytmetyka układu trzech kolumn.
 *
 * Wydzielona z komponentu, bo to jedyna część zwijania kolumn, którą da się
 * sprawdzić bez przeglądarki — reszta to nasłuch `resize` i stan Reacta.
 */

/*
 * Szerokości kolumn w pikselach. Muszą zgadzać się z klasami Tailwinda
 * w `StudioScreen` (`w-64`, `w-72`, `w-10`) — Tailwind skanuje literały,
 * więc klasy nie dają się złożyć ze zmiennej. Pilnuje tego test `uklad`.
 */
export const SZEROKOSC_LEWEJ = 256
export const SZEROKOSC_PRAWEJ = 288
export const SZEROKOSC_PASKA = 40

/**
 * Ile ma zostać na podgląd, zanim kolumny boczne zaczną się zwijać same.
 *
 * Wzięte z pomiaru, nie z punktów granicznych Tailwinda: przy powiększeniu
 * strony 150% na ekranie 1366 px kolumna środkowa schodziła do 367 px, czyli
 * 40% szerokości. Kadr 1664 px pokazany na 367 px to skala 22% — przy niej
 * grafik nie oceni ani ostrości, ani szumu, ani detalu.
 */
export const MIN_SRODEK = 640

export type StanKolumn = { lewa: boolean; prawa: boolean }

/**
 * Które kolumny mają być zwinięte przy danej szerokości okna.
 *
 * `zapamietane` to ustawienie grafika z `localStorage`. Próg może kolumnę
 * **zwinąć**, ale nigdy nie rozwinie tej, którą grafik zwinął sam.
 *
 * Prawa idzie pierwsza, bo panel eksportu jest potrzebny przy oddawaniu
 * roboty, a lista zleceń przy nawigacji — przy ciasnym ekranie grafik
 * najczęściej siedzi w jednym zleceniu i przegląda kadry.
 */
export function zwinieteKolumny(szerokoscOkna: number, zapamietane: StanKolumn): StanKolumn {
  const zPrawa = szerokoscOkna - SZEROKOSC_LEWEJ - SZEROKOSC_PRAWEJ
  const bezPrawej = szerokoscOkna - SZEROKOSC_LEWEJ - SZEROKOSC_PASKA
  return {
    prawa: zPrawa < MIN_SRODEK || zapamietane.prawa,
    lewa: bezPrawej < MIN_SRODEK || zapamietane.lewa,
  }
}

/** Ile pikseli zostaje na podgląd przy danym stanie kolumn. */
export function szerokoscSrodka(szerokoscOkna: number, stan: StanKolumn): number {
  return (
    szerokoscOkna -
    (stan.lewa ? SZEROKOSC_PASKA : SZEROKOSC_LEWEJ) -
    (stan.prawa ? SZEROKOSC_PASKA : SZEROKOSC_PRAWEJ)
  )
}
