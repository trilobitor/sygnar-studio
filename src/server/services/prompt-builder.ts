import type { Brief } from '@/lib/schemas'
import type { Order } from '@/server/db/schema'
import { COMPOSITION, CONSTRAINTS, paletteFor, REALISM } from './scene-rules'

/**
 * Deterministyczny składacz opisu sceny.
 *
 * Brief jest formularzem: siedem z dwunastu pól to listy wyboru, a ich
 * zamiana na angielski to tabela, nie zadanie dla modelu językowego.
 * Ten moduł składa z nich pełny opis sceny — kolejność informacji, światło,
 * paletę, kadr i detale techniczne — bez żadnego wywołania sieciowego.
 *
 * Wartości domyślne pochodzą z briefu realizacyjnego Sygnara §4.2, §4.4–4.7,
 * czyli z tego samego dokumentu, który obowiązuje fotografa na planie.
 * Dzięki temu kadr wygenerowany i kadr zrobiony aparatem wyglądają jak
 * jedna sesja, a nie jak dwa różne zlecenia.
 *
 * Czego ten moduł **nie** potrafi: przetłumaczyć swobodnego opisu po polsku.
 * To jedyny fragment briefu, który realnie wymaga modelu językowego.
 */

/** Wspólny język fotograficzny — brief §4.4. Obowiązuje każde ujęcie. */
const CAMERA_BY_SHOT: Record<string, string> = {
  closeup: 'a 50mm lens at f/2.0, shallow depth of field',
  medium: 'a 50mm lens at f/2.8',
  full: 'a 35mm lens at f/2.8',
  wide: 'a 35mm lens at f/2.8, deep focus',
}

const ANGLE_PHRASES: Record<string, string> = {
  eye: 'from eye level',
  high: 'from slightly above',
  low: 'from slightly below eye level',
  top: 'looking straight down',
}

const LIGHTING_PHRASES: Record<string, string> = {
  natural: 'lit by a single dominant window light from one side, fill from a reflector',
  studio: 'lit by a single large softbox from one side, gentle fill on the shadow side',
  neon: 'lit by coloured neon signage spilling across the scene from one side',
  candle: 'lit by warm candlelight low in the frame',
  overcast: 'lit by soft even daylight from an overcast sky',
}

const STYLE_PHRASES: Record<string, string> = {
  photo: 'Photographed on a full-frame camera',
  illustration: 'Drawn as a clean editorial illustration, rendered as if photographed',
  render3d: 'Rendered in 3D with physically based materials, framed',
  sketch: 'Drawn as a loose pencil sketch, composed',
  flat: 'Designed as flat vector artwork, laid out',
}






export interface BuiltPrompt {
  promptEn: string
  /** Co składacz uzupełnił za grafika. Po polsku, tak jak w oknie briefu. */
  assumptions: string[]
}

function sentenceOne(brief: Brief): string {
  // Punkt pierwszy idzie prosto z briefu — to jedyne pole, którego
  // składacz nie tłumaczy i nie przepisuje.
  const subject = brief.subject.trim().replace(/\.$/, '')
  const place = brief.place?.trim()
  return place === undefined || place.length === 0 ? subject : `${subject}, in ${place}`
}

function lightSentence(brief: Brief, assumptions: string[]): string {
  const lighting = brief.lighting ?? 'natural'
  if (brief.lighting === undefined) {
    assumptions.push('Przyjąłem światło naturalne — brief nie precyzował oświetlenia.')
  }

  const timeOfDay = brief.timeOfDay?.trim()
  const time =
    timeOfDay === undefined || timeOfDay.length === 0
      ? 'in the late afternoon'
      : `at ${timeOfDay}`

  if (timeOfDay === undefined || timeOfDay.length === 0) {
    assumptions.push(
      'Ustawiłem późne popołudnie — o tej porze światło jest ciepłe i kierunkowe, zgodnie z językiem zdjęciowym Sygnara.',
    )
  }

  const phrase = LIGHTING_PHRASES[lighting] ?? LIGHTING_PHRASES.natural
  return `The scene is ${phrase}, ${time}, at around 5200K with medium contrast and detail held in the shadows`
}

function moodSentence(brief: Brief, order: Order | null, assumptions: string[]): string {
  const mood = brief.mood?.trim()
  const colors = brief.colors?.trim()

  const look = paletteFor(order, colors)
  const industry = order?.industry ?? null

  if ((colors === undefined || colors.length === 0) && industry !== null) {
    assumptions.push(
      'Paletę wziąłem z kolorów branży — dzięki temu kadr siądzie na tle strony bez wypalania dziury.',
    )
  }

  const feeling = mood === undefined || mood.length === 0 ? 'Calm and restrained' : `Calm, ${mood}`
  return `${feeling}, with ${look}`
}

function techniqueSentence(brief: Brief, assumptions: string[]): string {
  const style = brief.style ?? 'photo'
  if (brief.style === undefined) {
    assumptions.push('Przyjąłem fotografię — brief nie precyzował stylu.')
  }

  const shot = brief.shot ?? 'medium'
  if (brief.shot === undefined) {
    assumptions.push('Przyjąłem plan średni i wysokość oczu — to najbezpieczniejszy kadr.')
  }

  const angle = brief.angle ?? 'eye'
  const camera = CAMERA_BY_SHOT[shot] ?? CAMERA_BY_SHOT.medium
  const anglePhrase = ANGLE_PHRASES[angle] ?? ANGLE_PHRASES.eye
  const stylePhrase = STYLE_PHRASES[style] ?? STYLE_PHRASES.photo

  return `${stylePhrase} with ${camera} ${anglePhrase}, fine film grain`
}

/**
 * Składa opis sceny z briefu. Zawsze się udaje — nie ma tu sieci,
 * nie ma zewnętrznej usługi i nie ma czego zepsuć.
 */
export function buildPrompt(brief: Brief, order: Order | null): BuiltPrompt {
  // Dwie listy, nie jedna. Limit trzech pozycji jest twardy (SPEC §6),
  // więc ostrzeżenia wymagające reakcji muszą wyprzedzać informacje
  // o przyjętych wartościach domyślnych — inaczej wypadają z listy.
  const warnings: string[] = []
  const assumptions: string[] = []

  const parts = [
    sentenceOne(brief),
    lightSentence(brief, assumptions),
    moodSentence(brief, order, assumptions),
    COMPOSITION,
    techniqueSentence(brief, assumptions),
  ]

  // Tekst na obrazie wymieniamy raz i tylko wtedy, gdy grafik go podał.
  const text = brief.textOnImage?.trim()
  if (text !== undefined && text.length > 0) {
    parts.splice(1, 0, `a sign that says "${text}" in clean uppercase letters, flat and facing the camera`)
    if (text.length > 14) {
      warnings.push(
        'Napis jest dłuższy niż kilkanaście znaków — przy takiej długości litery często wychodzą zniekształcone.',
      )
    }
  } else {
    parts.push(CONSTRAINTS)
  }

  parts.push(REALISM)

  const promptEn = `${parts.join('. ')}.`.replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim()

  // Twardy limit z `promptResultSchema` — lepiej przyciąć na granicy zdania
  // niż oddać opis ucięty w połowie słowa.
  const trimmed = promptEn.length <= 1500 ? promptEn : `${promptEn.slice(0, 1497).replace(/[^.]*$/, '')}`.trim()

  // Pole „czego unikać" przepisujemy na pozytyw tylko wtedy, gdy grafik
  // coś wpisał — sam model pracuje bez negatywnego promptu.
  const avoid = brief.avoid?.trim()
  if (avoid !== undefined && avoid.length > 0) {
    warnings.push(
      'Pole „czego unikać" zostało przy opisie po polsku — bez modelu językowego nie przepiszę go na angielski. Sprawdź opis przed uruchomieniem.',
    )
  }

  return { promptEn: trimmed, assumptions: [...warnings, ...assumptions].slice(0, 3) }
}

/**
 * Czy opis wygląda na polski. Składacz przepuszcza punkt pierwszy bez
 * tłumaczenia, więc trzeba grafika ostrzec, zanim wyśle to do modelu.
 */
export function looksPolish(text: string): boolean {
  if (/[ąćęłńóśźż]/i.test(text)) return true

  // Krótkie polskie słowa funkcyjne bez znaków diakrytycznych.
  const markers = /\b(jest|nie|oraz|przy|dla|pod|nad|jak|tego|która|który|takie|bardzo)\b/i
  return markers.test(text)
}
