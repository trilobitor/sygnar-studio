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
export const CONSTRAINTS =
  'No lettering or logos anywhere in the scene, no one looking into the lens, hands and faces anatomically correct'

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
