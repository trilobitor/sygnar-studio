'use client'

/**
 * Ekran awarii dla całego panelu.
 *
 * Bez tego pliku Next pokazuje własny, angielski ekran z napisem
 * „Application error: a client-side exception has occurred" — grafik nie ma
 * z tego żadnej wskazówki ani przycisku, którym mógłby spróbować ponownie.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="font-serif text-2xl text-ink">Coś się zacięło</h1>
        <p className="text-sm text-ink-muted">
          Panel napotkał błąd i nie potrafi wyświetlić tej strony. Spróbuj jeszcze raz — jeśli
          to nie pomoże, napisz do Kamila.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mx-auto rounded bg-accent px-4 py-2 text-sm font-medium text-surface"
        >
          Spróbuj jeszcze raz
        </button>
      </div>
    </main>
  )
}
