'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Prymitywy interfejsu.
 *
 * [ODSTĘPSTWO] `SPEC.md` wymienia shadcn/ui, ale jego generator wymaga
 * odpowiedzi na pytanie o bibliotekę komponentów i nie da się go uruchomić
 * bez interakcji. Prymitywy poniżej trzymają się tego samego API, żeby
 * podmiana na wygenerowane komponenty była zamianą importów.
 * Wpis w `dziennik/DECYZJE.md`, D11.
 *
 * Dostępność (SPEC §10): każde pole ma `label htmlFor`, wszystko klikalne
 * działa z klawiatury i ma widoczny focus, ikony mają `aria-label`.
 */

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-surface-0 font-medium hover:brightness-110',
  /*
   * Wariant drugorzędny dostał obwódkę. Bez niej płaska plama `surface-2`
   * zlewała się z tłem panelu i nie wyglądała na coś, w co można kliknąć.
   */
  ghost: 'border border-field bg-surface-2 text-ink hover:border-ink-muted hover:bg-line',
  danger: 'border border-danger bg-transparent text-danger-text hover:bg-danger/10',
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled = false,
  type = 'button',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm leading-snug text-balance transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_STYLES[variant]}`}
    >
      {children}
    </button>
  )
}

/**
 * Znacznik klawisza skrótu na przycisku.
 *
 * `aria-hidden`, bo nazwa przycisku ma zostać nazwą akcji — czytnik ekranu
 * czytający „Powtórz bez zmian 3" brzmi jak lista, nie jak polecenie. Skrót
 * jedzie do `title`, gdzie szuka go i mysz, i klawiatura.
 *
 * Kolor dziedziczony (`border-current`, `opacity`), nie ustalony na sztywno:
 * na przycisku głównym tło jest mosiężne, a napis prawie czarny — szary
 * znacznik ginął na nim zupełnie. Zmierzone na zrzucie, nie wydedukowane.
 */
export function Skrot({ klawisz }: { klawisz: string }) {
  return (
    <span
      aria-hidden
      className="ml-2 rounded border border-current px-1 text-[0.6875rem] leading-4 font-normal opacity-60"
    >
      {klawisz}
    </span>
  )
}

/**
 * Dymek ze słowniczka. Natywny `title` odpada — przeglądarka pokazuje go
 * dopiero po sekundzie najechania, a w oknie modalnym często wcale.
 * Ten pojawia się od razu i odpowiada też na focus z klawiatury.
 */
export function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`Podpowiedź: ${text}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        className="ml-1 cursor-help rounded-full px-1 text-ink-muted transition hover:text-accent"
      >
        ⓘ
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1 block w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed font-normal text-ink shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}

/** Pole z etykietą i dymkiem ze słowniczka. */
export function Field({
  required = false,
  label,
  hint,
  children,
  counter,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
  counter?: string
  /** Pole wymagane — dostaje widoczny znacznik i informację dla czytnika. */
  required?: boolean
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      {/* Dymek stoi obok etykiety, nie w niej — przycisk wewnątrz `label`
          przekazywałby kliknięcie do pola i otwierał listy wyboru. */}
      <div className="flex items-baseline justify-between text-sm text-ink">
        <span className="flex items-baseline">
          <label htmlFor={id}>{label}</label>
          {/* Wymagalność była niewidoczna: pole różniło się od reszty tylko
              tym, że bez niego przycisk zostawał wyłączony, a nic nie mówiło
              dlaczego. */}
          {required && (
            <span className="ml-1 text-accent" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only"> (pole wymagane)</span>}
          {hint !== undefined && <Hint text={hint} />}
        </span>
        {counter !== undefined && <span className="text-xs text-ink-muted">{counter}</span>}
      </div>
      {children(id)}
    </div>
  )
}

/*
 * Wspólny wygląd pól.
 *
 * Były niskie i nie dawały żadnego sygnału przy focusie poza domyślną obwódką
 * przeglądarki — na ciemnym tle prawie niewidoczną. Wysokość zgadza się teraz
 * z przyciskami, więc pole i przycisk w jednym rzędzie stoją równo.
 */
const INPUT_CLASS =
  'w-full min-h-10 rounded-md border border-field bg-surface-2 px-3 py-2 text-sm text-ink transition placeholder:text-ink-muted hover:border-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25'

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={INPUT_CLASS}
    />
  )
}

export function TextArea({
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
  maxLength,
  lang,
  naKlawisz,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  maxLength?: number
  /**
   * Język treści pola, gdy różni się od języka dokumentu. Bez tego czytnik
   * ekranu czyta angielski opis polską fonetyką — dokument jest oznaczony
   * jako `pl`, a opis dla modelu jest po angielsku.
   */
  lang?: string
  /**
   * Skrót działający **wewnątrz** pola. Globalny nasłuch milknie, gdy focus
   * siedzi w polu tekstowym — inaczej każda wpisana litera byłaby skrótem —
   * więc ⌘↵ z opisu sceny musi wejść tędy.
   */
  naKlawisz?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
}) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      lang={lang}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={naKlawisz}
      className={INPUT_CLASS}
    />
  )
}

export function Select({
  id,
  value,
  onChange,
  options,
  allowEmpty = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  allowEmpty?: boolean
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={INPUT_CLASS}
    >
      {allowEmpty && <option value="">— bez wskazania —</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Okno modalne. Brief zasługuje na pełną uwagę, więc kadr, podgląd
 * i kolejka mu wtedy nie przeszkadzają (SPEC §10).
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      // Pułapka focusu. Bez niej Tab wychodził z okna na stronę pod spodem
      // i grafik pracujący z klawiatury tracił kontakt z formularzem, nie
      // widząc gdzie jest kursor — okno przykrywa resztę ekranu.
      const panel = panelRef.current
      if (panel === null) return

      const focusowalne = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)

      if (focusowalne.length === 0) return

      const pierwszy = focusowalne[0]
      const ostatni = focusowalne[focusowalne.length - 1]
      if (pierwszy === undefined || ostatni === undefined) return

      const aktywny = document.activeElement

      if (event.shiftKey && (aktywny === pierwszy || aktywny === panel)) {
        event.preventDefault()
        ostatni.focus()
        return
      }

      if (!event.shiftKey && aktywny === ostatni) {
        event.preventDefault()
        pierwszy.focus()
      }
    }

    document.addEventListener('keydown', onKey)

    // Tło nie ma się przewijać pod otwartym oknem.
    const zastaneOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = zastaneOverflow
    }
  }, [open, onClose])

  /*
   * Okno renderujemy do własnego węzła doczepionego do `<body>`, a całą resztę
   * dokumentu oznaczamy `inert` na czas jego otwarcia.
   *
   * Pułapka tabulatora niżej pilnuje klawiatury, ale nie zasłania treści przed
   * czytnikiem ekranu przeglądającym dokument po swojemu. `inert` załatwia
   * jedno i drugie natywnie. Portal jest tu konieczny: bez niego okno leży
   * wewnątrz drzewa aplikacji, więc `inert` na kontenerze wyłączałby także je.
   */
  const oknoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const okno = oknoRef.current
    const rodzenstwo = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== okno,
    )
    const zastane = rodzenstwo.map((element) => element.inert)

    for (const element of rodzenstwo) element.inert = true

    return () => {
      rodzenstwo.forEach((element, index) => {
        element.inert = zastane[index] ?? false
      })
    }
  }, [open])

  // Fokus ustawiamy **raz**, przy otwarciu — w osobnym efekcie zależnym tylko
  // od `open`. Wcześniej siedział razem z nasłuchem Escape, którego zależność
  // `onClose` zmieniała tożsamość przy każdej ramce SSE. Efekt uruchamiał się
  // wtedy co sekundę i wyrywał kursor z pola, w którym grafik pisał brief.
  useEffect(() => {
    if (!open) return

    // Focus wraca tam, skąd okno otwarto. Bez tego po zamknięciu przepadał
    // na `<body>` i osoba pracująca z klawiatury musiała przechodzić całą
    // stronę od początku, żeby wrócić do przycisku, który właśnie nacisnęła.
    const skad = document.activeElement

    panelRef.current?.focus()

    return () => {
      if (skad instanceof HTMLElement) skad.focus()
    }
  }, [open])

  // Okno otwiera się wyłącznie z akcji grafika, więc render po stronie serwera
  // nigdy tu nie dochodzi — ale strażnik kosztuje jedną linię.
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={oknoRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-3xl rounded-lg border border-line bg-surface-1 shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno"
            className="rounded px-2 py-1 text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Menu pod trzema kropkami przy wierszu listy. Zamyka się klawiszem Escape
 * i kliknięciem obok, a samo działa z klawiatury tak jak reszta interfejsu.
 */
export function RowMenu({
  label,
  items,
}: {
  label: string
  items: { label: string; onSelect: () => void; danger?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent): void {
      // `event.target` jest typowane jako `EventTarget`, ale `contains`
      // przyjmuje `Node`; w zdarzeniu myszy w dokumencie to zawsze węzeł DOM.
      const target = event.target as Node
      if (wrapper.current?.contains(target) === false) setOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded px-2 py-1 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
      >
        ⋯
      </button>

      {open && (
        <div
          // Bez ról `menu`/`menuitem`: deklarowały obsługę strzałek, której
          // nie było, więc czytnik ekranu obiecywał zachowanie nieistniejące.
          // Zwykła lista przycisków odpowiada temu, co komponent naprawdę robi.
          role="group"
          className="absolute right-0 top-full z-20 mt-1 min-w-40 overflow-hidden rounded border border-line bg-surface-2 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-line ${
                item.danger === true ? 'text-danger-text' : 'text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Puste stany mówią, co zrobić dalej, nie „brak danych" (SPEC §7a). */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
      {children}
    </div>
  )
}
