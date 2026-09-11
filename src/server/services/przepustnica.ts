/**
 * Przepustnica na kosztowne wywołania.
 *
 * `scrypt` przy koszcie 2^17 zajmuje wątek puli libuv na ~318 ms (zmierzone
 * na tej maszynie) i 128 MiB pamięci. Pula ma domyślnie cztery wątki, więc
 * garść równoległych żądań do `/api/auth` — endpointu **dostępnego bez
 * zalogowania** — potrafi zatkać wszystko inne, łącznie z odpowiadaniem na
 * `/api/health`.
 *
 * Przepustnica jest nieblokująca: kto się nie zmieści, dostaje odmowę od razu.
 * Kolejkowanie tylko przesuwałoby problem, bo czekające żądania i tak trzymają
 * pamięć.
 */

export class Przepustnica {
  private zajete = 0

  constructor(private readonly limit: number) {}

  /** Zwraca funkcję zwalniającą albo `null`, gdy nie ma miejsca. */
  sprobuj(): (() => void) | null {
    if (this.zajete >= this.limit) return null

    this.zajete += 1
    let zwolnione = false

    return () => {
      // Podwójne zwolnienie zaniżyłoby licznik i z czasem otworzyło
      // przepustnicę na oścież.
      if (zwolnione) return
      zwolnione = true
      this.zajete -= 1
    }
  }

  get wolne(): number {
    return this.limit - this.zajete
  }
}

/**
 * Dwa równoległe sprawdzenia hasła. Więcej nie ma sensu: przy czterech
 * wątkach puli trzecie i tak czekałoby, blokując pamięć.
 *
 * Uwaga: jedno „sprawdzenie hasła" to tyle wywołań scrypt, ile jest osób
 * z dostępem — porównujemy z każdą, żeby czas odpowiedzi nie zdradzał,
 * która pozycja pasuje.
 */
export const przepustnicaHasel = new Przepustnica(2)

/**
 * Dwa równoległe składania opisu przez model.
 *
 * Wywołanie `claude -p` jest wielokrotnie cięższe od jednego `scrypt`, a do
 * poprawki SYG-109 nie miało żadnego sufitu: jedyną zaporą był wspólny kubełek
 * limitu żądań o pojemności dwudziestu na minutę. Dwadzieścia równoległych
 * procesów Claude Code na maszynie, na której jedno generowanie zajmuje
 * 18–28 GB, to nie jest stan, z którego da się wyjść.
 *
 * Odmowa nie jest błędem — spada na składacz deterministyczny.
 */
export const przepustnicaOpisow = new Przepustnica(2)
