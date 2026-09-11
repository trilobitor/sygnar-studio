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
   * Ikona jako ścieżki wektorowe, rysowane obrysem w siatce 24 × 24.
   *
   * Nie emoji — te renderują się krojem systemowym i w kolorze, więc nigdy
   * nie pasują do reszty interfejsu (UX-002). Nie znak tekstowy — przy
   * ikonie wielkości kilkudziesięciu pikseli znak z kroju pisma wygląda
   * ubogo i zależy od tego, co akurat ma w sobie font systemowy.
   * Nie biblioteka ikon — to zależność, a `CLAUDE.md` każe o nie pytać.
   */
  ikona: readonly string[]
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
    opis:
      'Opisz scenę, a stacja policzy kilka kadrów do wyboru. Potem przytniesz ' +
      'wybrany, poprawisz w nim fragment i zapiszesz gotowy plik w wymiarach ' +
      'i wadze wymaganych przez kanał, do którego trafia.',
    ikona: [
      // Ramka kadru, słońce i linia wzgórz — klasyczny znak obrazu.
      'M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z',
      'M3 16.5l4.5-4.5 3.5 3.5 3-3 6 6',
      'M10 8.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z',
    ],
    stan: 'dostepne',
    rodzajeZadan: ['image_generate', 'image_edit', 'image_export', 'photo_batch'],
  },
  {
    klucz: 'wideo',
    nazwa: 'Wideo',
    opis:
      'Opisz ujęcie, a stacja policzy z niego klip. Pięć sekund materiału ' +
      'zajmuje jej około pięciu minut, więc klip zamawia się jak zlecenie ' +
      'i odbiera później. Zmontujesz tu też własny materiał: przycięcie, ' +
      'kadr pod format, pętla i plansza.',
    ikona: [
      // Klatka filmu z perforacją i trójkątem odtwarzania.
      'M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z',
      'M3 8.5h3M3 15.5h3M18 8.5h3M18 15.5h3M7.5 3v18M16.5 3v18',
      'M10.75 9.25l3.75 2.75-3.75 2.75z',
    ],
    stan: 'dostepne',
    rodzajeZadan: ['video_generate', 'video_render'],
  },
]

/** Narzędzie o tym kluczu albo `null`, gdy adres wskazuje na nieistniejące. */
export function narzedzie(klucz: string): Narzedzie | null {
  return NARZEDZIA.find((n) => n.klucz === klucz) ?? null
}
