/**
 * Uruchamiane przez Next.js raz, przy starcie serwera.
 *
 * Plik jest kompilowany **dla obu runtime'ów** — także dla Edge, gdzie nie ma
 * `process.stdout` ani `better-sqlite3`. Dlatego cała robota siedzi w osobnym
 * module ładowanym wyłącznie w Node; bez tego rozdziału bundler Edge próbował
 * wciągnąć logger i wywracał build całej aplikacji.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
