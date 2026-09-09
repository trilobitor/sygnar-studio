'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

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
  primary: 'bg-accent text-surface-0 hover:brightness-110 font-medium',
  ghost: 'bg-surface-2 text-ink hover:bg-line',
  danger: 'bg-transparent text-danger border border-danger hover:bg-danger/10',
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
      className={`rounded px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_STYLES[variant]}`}
    >
      {children}
    </button>
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
          className="absolute left-0 top-full z-50 mt-1 block w-72 rounded border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed font-normal text-ink shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  )
}

/** Pole z etykietą i dymkiem ze słowniczka. */
export function Field({
  label,
  hint,
  children,
  counter,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
  counter?: string
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1">
      {/* Dymek stoi obok etykiety, nie w niej — przycisk wewnątrz `label`
          przekazywałby kliknięcie do pola i otwierał listy wyboru. */}
      <div className="flex items-baseline justify-between text-sm text-ink">
        <span className="flex items-baseline">
          <label htmlFor={id}>{label}</label>
          {hint !== undefined && <Hint text={hint} />}
        </span>
        {counter !== undefined && <span className="text-xs text-ink-muted">{counter}</span>}
      </div>
      {children(id)}
    </div>
  )
}

const INPUT_CLASS =
  'w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted'

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
}: {
  id: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  maxLength?: number
}) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
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
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6">
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
    </div>
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
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-40 overflow-hidden rounded border border-line bg-surface-2 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-line ${
                item.danger === true ? 'text-danger' : 'text-ink'
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
