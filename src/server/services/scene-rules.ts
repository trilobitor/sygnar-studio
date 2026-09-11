import { ryzykownaPoza } from '@/lib/pozy'
import type { Order } from '@/server/db/schema'

// Re-eksport dla kodu serwerowego, który sięgał tu od początku.
export { ryzykownaPoza }

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
 * Sufit długości wyniku.
 *
 * Bierzemy go z `generateJobSchema.promptEn` (2000) — czyli z pola, **do
 * którego ten wynik trafia**. Wcześniej stało tu 1500, wzięte z
 * `promptResultSchema.prompt_en`, które ogranicza co innego: ile wolno zwrócić
 * **modelowi**. Pomylenie tych dwóch schematów było przyczyną SYG-105.
 */
const MAX_PROMPT = 2000

/** Długość separatora „. " wstawianego między opis a pierwszą regułę. */
const SPOINA = 2

/** Składa części w jedno zdanie ciągłe, bez podwójnych kropek i spacji. */
function zloz(czesci: readonly string[]): string {
  return `${czesci.join('. ')}.`.replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim()
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

  const pelny = zloz(czesci)
  if (pelny.length <= MAX_PROMPT) return pelny

  /*
   * Za długo — skracamy **opis modelu**, nigdy reguł.
   *
   * Wcześniej obcinaliśmy gotowy wynik od końca, a reguły są doklejane
   * właśnie na końcu, więc obcinanie kasowało dokładnie je (SYG-105).
   * Przy opisie 1500 znaków nie zostawała ani jedna z czterech, a panel
   * meldował sukces — grafik nie miał jak zauważyć, że kadr policzono bez
   * zakazu liter i bez realiów polskich. Reguły są nienegocjowalne (D14),
   * więc to opis musi ustąpić.
   */
  const opis = czesci[0] ?? ''
  const reguly = czesci.slice(1)
  const miejsce = MAX_PROMPT - zloz(reguly).length - SPOINA

  if (miejsce <= 0) return zloz(reguly)

  // Najpierw próba na granicy zdania, żeby nie zostawiać urwanego zdania.
  const doKropki = opis.slice(0, miejsce).replace(/[^.]*$/, '').trim()

  /*
   * Gdy w opisie nie ma ani jednej kropki przed progiem, cięcie na granicy
   * zdania zwraca pustkę. Wtedy tniemy na twardo: urwane zdanie jest złe,
   * ale pusty prompt nie przeszedłby nawet walidacji `promptEn` (min 10),
   * a grafik dostawał wyszarzony przycisk bez wyjaśnienia.
   */
  const przyciety = doKropki.length > 0 ? doKropki : opis.slice(0, miejsce).trim()

  return zloz([przyciety, ...reguly].filter((czesc) => czesc.length > 0))
}

