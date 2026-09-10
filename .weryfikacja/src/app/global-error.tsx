'use client'

/**
 * Awaria na tyle wczesna, że nie zadziałał nawet `error.tsx` — na przykład
 * w samym `layout.tsx`. Ten plik zastępuje `<html>` i `<body>`, więc nie może
 * polegać na stylach z `globals.css`.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="pl">
      <body
        style={{
          background: '#141414',
          color: '#e8e6e3',
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Panel się nie uruchomił</h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.7, marginBottom: '1.5rem' }}>
            Coś poszło nie tak jeszcze przed wyświetleniem strony. Spróbuj jeszcze raz — jeśli
            to nie pomoże, napisz do Kamila.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#c9a227',
              color: '#141414',
              border: 0,
              borderRadius: '0.25rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Spróbuj jeszcze raz
          </button>
        </div>
      </body>
    </html>
  )
}
