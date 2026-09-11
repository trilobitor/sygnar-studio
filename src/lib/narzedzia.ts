import type { JOB_KINDS } from '@/lib/enums'

type JobKind = (typeof JOB_KINDS)[number]

/**
 * Rejestr narzędzi — źródło ekranu kafelków (SPEC §12, sekcja C audytu).
 *
 * Kafelki są **wpisami w tej tablicy**, a ekran jest pętlą po niej. Dopisanie
 * narzędzia to dopisanie wpisu, nie napisanie kolejnej karty w JSX — inaczej
 * siatka przestaje się skalować przy trzecim kafelku.
 *
 * Moduł jest czysty i leży w `lib/`, nie w `server/`: czyta go komponent
 * kliencki, a komponentom nie wolno sięgać do `server/` (SYG-110, pilnuje
 * tego reguła lintu).
 */

export type StanNarzedzia = 'dostepne' | 'wkrotce' | 'niedostepne'

export interface Narzedzie {
  /** Klucz w adresie: `/n/<klucz>`. Po wydaniu się nie zmienia. */
  klucz: string
  nazwa: string
  /** Jedno zdanie. W kafelku ma się zmieścić w dwóch linijkach. */
  opis: string
  /**
   * Znak z rodziny tekstowej, nie emoji.
   *
   * Emoji renderują się krojem systemowym i w kolorze, więc nigdy nie pasują
   * do reszty znaków w interfejsie — ustalenie z sekcji A audytu (UX-002).
   */
  znak: string
  stan: StanNarzedzia
  /**
   * Rodzaje zadań, których bieg oznacza „to narzędzie właśnie pracuje".
   *
   * Czwarty stan kafelka — „w trakcie pracy" — celowo **nie jest** polem
   * wpisu. Rejestr jest statyczny, a to, czy coś liczy się w tej chwili,
   * zmienia się co sekundę; ekran składa jedno z drugim.
   */
  rodzajeZadan: readonly JobKind[]
  /** Powód, gdy stan nie jest `dostepne`. Pokazywany wprost, nie w dymku. */
  powod?: string
}

export const NARZEDZIA: readonly Narzedzie[] = [
  {
    klucz: 'obrazy',
    nazwa: 'Obrazy',
    opis: 'Opisz scenę, a stacja policzy kilka kadrów do wyboru.',
    // Siatka, bo to narzędzie pokazuje galerię kadrów. `◫` czytało się jak
    // pusty prostokąt i nie mówiło nic.
    znak: '▦',
    stan: 'dostepne',
    rodzajeZadan: ['image_generate', 'image_edit', 'image_export', 'photo_batch'],
  },
  {
    klucz: 'wideo',
    nazwa: 'Wideo',
    opis: 'Opisz ujęcie i odbierz klip za kilka minut.',
    znak: '▷',
    stan: 'wkrotce',
    // Powód konkretny, nie „w przygotowaniu": grafik ma wiedzieć, na co czeka.
    powod: 'Pięć sekund klipu liczy się tu pięć minut. Czekamy na ocenę jakości.',
    rodzajeZadan: ['video_render'],
  },
]

/** Narzędzie o tym kluczu albo `null`, gdy adres wskazuje na nieistniejące. */
export function narzedzie(klucz: string): Narzedzie | null {
  return NARZEDZIA.find((n) => n.klucz === klucz) ?? null
}
