import type { Order } from '@/server/db/schema'

/**
 * Reguły sceny nienegocjowalne — brief realizacyjny §4.2, §4.5, §4.6, §4.7.
 *
 * Decyzja D14 mówi wprost, że te reguły **składa kod, zawsze tak samo**,
 * a model językowy odpowiada wyłącznie za swobodny opis w punkcie pierwszym.
 * Wcześniej mieszkały tylko w składaczu deterministycznym, czyli w gałęzi
 * uruchamianej dopiero po awarii dwóch pozostałych — domyślna ścieżka przez
 * model ich nie stosowała i dawała kadry gorzej zgodne z briefem niż ścieżka
 * awaryjna. Teraz doklejamy je do wyniku niezależnie od źródła.
 */

/**
 * Paleta i ekspozycja per branża — brief §4.2.
 *
 * Medical jest jedyną branżą na jasnym tle, więc jako jedyna dostaje
 * zdjęcia high-key. Reszta siedzi na tle #14100a–#0e1116, gdzie jasne
 * zdjęcie „wypala dziurę" w layoucie.
 */
export const INDUSTRY_LOOK: Record<string, string> = {
  legal: 'a low-key palette of warm browns, deep shadow and a single stroke of pale gold',
  medical: 'a high-key palette of clean whites, soft teal and bright open shadows',
  estate: 'a low-key palette of cool blues, deep shadow and pale daylight',
  build: 'a low-key palette of terracotta, concrete grey and deep shadow',
  other: 'a low-key palette of cool steel greys and deep shadow',
}

export const DEFAULT_LOOK = 'a restrained palette with deep shadow and one warm accent'

/**
 * Martwe strefy kadru — brief §4.5.
 *
 * `showcase-card.tsx` nakłada gradient na dolne 40% i chipy na górze,
 * więc górne 15% i dolne 35% kadru są zasłonięte. Temat musi mieścić się
 * w środkowym pasie, inaczej layout zje połowę zdjęcia.
 */
export const COMPOSITION =
  'The subject sits in the middle horizontal band of the frame, well clear of the top and bottom edges, positioned in the left or right third with the centre left open'

/** Bezwzględne zakazy z §4.6, przepisane na sformułowania pozytywne. */
/**
 * Zakazy z §4.6 rozbite na dwie części.
 *
 * Wcześniej były jednym napisem doklejanym **tylko wtedy, gdy grafik nie podał
 * napisu na obrazie**. Skutek: przy zadanym napisie znikało nie tylko „bez
 * liter", ale też „ręce i twarze anatomicznie poprawne" i „nikt nie patrzy
 * w obiektyw" — czyli akurat te reguły, które z napisem nie mają nic wspólnego,
 * a przy postaciach ważą najwięcej.
 */
export const NO_LETTERING = 'No lettering or logos anywhere in the scene'

/** Obowiązuje zawsze, także gdy w kadrze ma być napis. */
export const ALWAYS =
  'no one looking into the lens, hands and faces anatomically correct, no brand marks on clothing or props'

/** Pełny zestaw — dla scen bez zadanego napisu. */
export const CONSTRAINTS = `${NO_LETTERING}, ${ALWAYS}`

/** Realia polskie — §4.7. */
export const REALISM =
  'A modern Polish interior: light oak, white plaster, architectural concrete and glass, European fittings, European city architecture beyond the windows'

/** Paleta dla zlecenia. Kolory podane przez grafika mają pierwszeństwo. */
export function paletteFor(order: Order | null, colors: string | undefined): string {
  const wlasne = colors?.trim()
  if (wlasne !== undefined && wlasne.length > 0) return `a palette built around ${wlasne}`

  const industry = order?.industry ?? null
  return industry === null ? DEFAULT_LOOK : (INDUSTRY_LOOK[industry] ?? DEFAULT_LOOK)
}

/**
 * Dokleja reguły do gotowego opisu sceny, pomijając te, które model już
 * spełnił. Sprawdzenie jest pobieżne z rozmysłem — lepiej powtórzyć regułę
 * niż jej nie zastosować, a model i tak dostaje ją w prompcie systemowym.
 */
export function applySceneRules(
  promptEn: string,
  order: Order | null,
  brief: { colors?: string; textOnImage?: string },
): string {
  const czesci = [promptEn.trim().replace(/\.$/, '')]
  const nizej = promptEn.toLowerCase()

  if (!nizej.includes('middle horizontal band') && !nizej.includes('middle band')) {
    czesci.push(COMPOSITION)
  }

  // Zakaz liter obowiązuje tylko wtedy, gdy grafik nie zamówił napisu.
  const napis = brief.textOnImage?.trim()
  if ((napis === undefined || napis.length === 0) && !nizej.includes('no lettering')) {
    czesci.push(CONSTRAINTS)
  }

  if (!nizej.includes('polish') && !nizej.includes('european')) {
    czesci.push(REALISM)
  }

  const paleta = paletteFor(order, brief.colors)
  if (!nizej.includes('palette')) {
    czesci.push(`Rendered with ${paleta}`)
  }

  const wynik = `${czesci.join('. ')}.`.replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim()

  // Twardy limit z `promptResultSchema` — przycinamy na granicy zdania.
  return wynik.length <= 1500 ? wynik : `${wynik.slice(0, 1497).replace(/[^.]*$/, '')}`.trim()
}

/**
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
