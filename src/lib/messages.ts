/**
 * Mapowanie kodów błędów na zdania dla grafika (SPEC §7a).
 *
 * `error_code` jest identyfikatorem technicznym. Użytkownik nigdy nie widzi
 * kodu ani treści wyjątku — widzi zdanie mówiące, **co zrobić dalej**,
 * nie co się zepsuło wewnątrz.
 *
 * Lista jest zamknięta. Nowy tryb awarii = nowy kod i nowy wpis,
 * nie ogólne „wystąpił błąd".
 */

export const ERROR_MESSAGES: Record<string, string> = {
  COMFY_UNREACHABLE: 'Stacja jest offline. Napisz do Kamila, żeby ją włączył.',
  COMFY_WORKFLOW_INVALID:
    'Coś jest nie tak z ustawieniami generowania — to po naszej stronie, nie po Twojej.',
  OUT_OF_MEMORY: 'Zabrakło pamięci na tak duży kadr. Spróbuj mniejszego formatu.',
  JOB_TIMEOUT: 'Zadanie trwało zbyt długo i zostało przerwane. Spróbuj jeszcze raz.',
  JOB_CANCELLED: 'Zadanie anulowane.',
  INTERRUPTED_BY_RESTART: 'Stacja została zrestartowana w trakcie. Uruchom zadanie ponownie.',
  UPLOAD_TOO_LARGE: 'Ten plik jest za duży. Maksymalnie 512 MB.',
  UPLOAD_UNSUPPORTED_TYPE:
    'Ten format pliku nie jest obsługiwany. Przyjmujemy JPG, PNG, MP4 i MOV.',
  FFMPEG_FAILED:
    'Nie udało się przygotować pliku wideo. Sprawdź, czy klip otwiera się poprawnie.',
  EXPORT_WEIGHT_UNREACHABLE:
    'Nie da się zejść do zadanej wagi bez utraty jakości. Podnieś limit albo zmniejsz kadr.',
  EXPORT_FAILED:
    'Nie udało się przygotować pliku do oddania. Sprawdź, czy kadr otwiera się poprawnie.',
  INTERNAL_ERROR: 'Coś poszło nie tak po naszej stronie. Odśwież stronę i spróbuj jeszcze raz.',
  DATABASE_UNAVAILABLE:
    'Baza zleceń nie odpowiada. Napisz do Kamila — plik bazy może być uszkodzony albo dysk pełny.',
  PROMPT_SERVICE_FAILED:
    'Nie udało się przygotować opisu po angielsku. Możesz wpisać go ręcznie poniżej.',
  // Komunikat obiecywał zaznaczone pola, a `aria-invalid` nie występuje
  // w kodzie ani razu — grafik szukał podświetlenia, którego nigdy nie było.
  // Zamiast obietnicy: konkretne granice, które łatwo sprawdzić wzrokiem.
  VALIDATION_FAILED:
    'Coś w formularzu się nie zgadza. Opis sceny musi mieć co najmniej trzy znaki, a liczba podejść od 1 do 8.',
  NOT_FOUND: 'Nie znaleźliśmy tego elementu. Odśwież stronę.',
  PATH_INVALID: 'Nie udało się otworzyć pliku — to po naszej stronie, nie po Twojej.',
  HEALTH_CHECK_FAILED: 'Nie udało się sprawdzić stanu stacji. Odśwież stronę za chwilę.',
  QUEUE_BUSY: 'Stacja liczy inne zadanie. Twoje ruszy, gdy tamto się skończy.',
  NOT_AUTHENTICATED: 'Sesja wygasła. Zaloguj się jeszcze raz.',
  BAD_PASSWORD: 'Hasło się nie zgadza.',
  TOO_MANY_ATTEMPTS: 'Za dużo prób pod rząd. Odczekaj kwadrans i spróbuj ponownie.',
}

/** Zdanie dla grafika. Nieznany kod też nie pokazuje kodu. */
export function messageForCode(code: string | null | undefined): string {
  if (code === null || code === undefined) return 'Coś poszło nie tak. Spróbuj jeszcze raz.'
  return ERROR_MESSAGES[code] ?? 'Coś poszło nie tak. Spróbuj jeszcze raz.'
}

/**
 * Słowniczek do dymków przy polach formularza (SPEC §7a).
 *
 * Grafik nie zobaczy w aplikacji ani jednego terminu technicznego
 * bez wyjaśnienia. Słowa „guidance", „kroki", „VAE", „ComfyUI" i „workflow"
 * nie pojawiają się w interfejsie ani raz.
 */
export const FIELD_HINTS = {
  subject:
    'Najważniejsze pole. Napisz, co ma być widać w kadrze — rzeczownikami, nie hasłami. „Puste biuro kancelarii o poranku" działa lepiej niż „kancelaria, elegancja, profesjonalizm".',
  purpose:
    'Gdzie ten obraz trafi. Od tego zależy kształt kadru i to, ile plik może ważyć — nie musisz o tym myśleć.',
  shot: 'Jak blisko jesteśmy tematu. Zbliżenie pokazuje detal, plan pełny pokazuje całą sytuację.',
  angle: 'Z jakiej wysokości patrzymy. Wysokość oczu jest neutralna i najbezpieczniejsza.',
  timeOfDay: 'Pora dnia zmienia kolor i kierunek światła. „Późne popołudnie" daje ciepłe, długie cienie.',
  lighting: 'Rodzaj światła. Naturalne wygląda jak zdjęcie, studyjne jak katalog.',
  place: 'Gdzie to się dzieje. Konkret pomaga: „nowoczesne polskie biuro, jasny dąb i beton" zamiast „ładne wnętrze".',
  mood: 'Nastrój sceny jednym–dwoma słowami. „Spokojny", „skupiony", „ciepły".',
  colors: 'Paleta, w której ma być utrzymany kadr. Możesz podać nazwy kolorów albo klimat.',
  style: 'Czy to ma wyglądać jak zdjęcie, ilustracja, czy render.',
  textOnImage:
    'Napis, który ma się pojawić w kadrze. Krótkie, wielkie litery wychodzą najpewniej. Dłuższy tekst często wychodzi zniekształcony.',
  avoid:
    'Czego nie chcesz w kadrze. Napisz normalnie — zamienimy to na opis tego, co ma być zamiast tego.',
  variants:
    'Ile różnych podejść do tej samej sceny policzyć. Każde trwa około pół minuty.',
  seed: 'Numer losowania — ten sam numer daje ten sam kadr. Zapisz go, jeśli chcesz wrócić do tego ujęcia.',
} as const

/** Etykiety etapów paska postępu (SPEC §10). */
export const STAGES = ['Brief', 'Generowanie', 'Wybór', 'Obróbka', 'Eksport'] as const

export const SHOT_LABELS: Record<string, string> = {
  closeup: 'Zbliżenie',
  medium: 'Plan średni',
  full: 'Plan pełny',
  wide: 'Plan szeroki',
}

export const ANGLE_LABELS: Record<string, string> = {
  eye: 'Wysokość oczu',
  high: 'Z góry',
  low: 'Z dołu',
  top: 'Prosto z góry',
}

export const LIGHTING_LABELS: Record<string, string> = {
  natural: 'Naturalne',
  studio: 'Studyjne',
  neon: 'Neonowe',
  candle: 'Świeca',
  overcast: 'Pochmurne',
}

export const STYLE_LABELS: Record<string, string> = {
  photo: 'Fotografia',
  illustration: 'Ilustracja',
  render3d: 'Render 3D',
  sketch: 'Szkic',
  flat: 'Grafika płaska',
}

export const INDUSTRY_LABELS: Record<string, string> = {
  legal: 'Kancelarie',
  medical: 'Kliniki',
  estate: 'Nieruchomości',
  build: 'Budowlana',
  other: 'Inne',
}

/**
 * Polska odmiana liczebników.
 *
 * Reguła: 1 → forma pojedyncza; 2–4 → forma mnoga „kilka", **z wyłączeniem
 * 12–14**, bo „12 podejścia" jest błędne; reszta → dopełniacz liczby mnogiej.
 *
 * Bez tego panel pisał „Policz 4 podejść" i „5 zadania przed Tobą" — obie
 * formy błędne, obie widoczne dla grafika przy każdym generowaniu.
 */
export function odmiana(n: number, formy: [string, string, string]): string {
  const bezwzgledna = Math.abs(n)

  if (bezwzgledna === 1) return formy[0]

  const dziesiatki = bezwzgledna % 100
  const jednosci = bezwzgledna % 10

  if (jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14)) {
    return formy[1]
  }

  return formy[2]
}

/**
 * Zacisk wartości liczbowej z pola formularza.
 *
 * Pola `type="number"` z atrybutami `min`/`max` **nie blokują** wpisania
 * wartości spoza zakresu ani wyczyszczenia pola — `Number('')` daje zero.
 * Bez zacisku grafik wysyłał zadanie, które serwer odrzucał komunikatem
 * o niezgodnym formularzu, bez wskazania, co poprawić.
 */
export function zacisnij(
  wartosc: number,
  { min, max, domyslna }: { min: number; max: number; domyslna: number },
): number {
  if (!Number.isFinite(wartosc) || wartosc === 0) return domyslna
  return Math.min(max, Math.max(min, wartosc))
}

/**
 * Skąd wziął się opis sceny. Bez żargonu — grafik nie musi wiedzieć, że
 * chodzi o CLI, API czy funkcję składającą tekst.
 */
export const SOURCE_LABELS: Record<string, string> = {
  cli: 'Opis przygotował model językowy.',
  api: 'Opis przygotował model językowy.',
  builder: 'Opis złożony z Twoich odpowiedzi, bez modelu językowego.',
}
