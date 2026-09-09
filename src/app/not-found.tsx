import Link from 'next/link'

/** Nieistniejący adres. Bez tego Next pokazuje własny ekran po angielsku. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="font-serif text-2xl text-ink">Nie ma takiej strony</h1>
        <p className="text-sm text-ink-muted">
          Ten adres nie prowadzi do niczego. Zlecenie mogło zostać usunięte.
        </p>
        <Link
          href="/"
          className="mx-auto rounded bg-accent px-4 py-2 text-sm font-medium text-surface"
        >
          Wróć do zleceń
        </Link>
      </div>
    </main>
  )
}
