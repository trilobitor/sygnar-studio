/**
 * Rozwiązywanie aliasu `@/` poza Next.js.
 *
 * Skrypty z `scripts/` uruchamia czysty Node, który o `tsconfig.paths` nic nie
 * wie — bez tego `npm run doktor` nie mógłby wywołać `collectHealth()` i
 * musiałby powtarzać sprawdzenia narzędzi drugi raz, we własnej wersji.
 * Dokładamy też rozszerzenie `.ts`: kod aplikacji pisze importy bez niego,
 * bo rozwiązuje je bundler.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function znajdz(baza: string): string | undefined {
  return [baza, `${baza}.ts`, `${baza}.tsx`, resolve(baza, 'index.ts')].find(
    (sciezka) => existsSync(sciezka) && !sciezka.endsWith('/'),
  )
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Alias `@/` wskazuje na `src/`.
    if (specifier.startsWith('@/')) {
      const trafiony = znajdz(resolve('src', specifier.slice(2)))
      if (trafiony !== undefined) return { url: pathToFileURL(trafiony).href, shortCircuit: true }
    }

    // Importy względne bez rozszerzenia — kod aplikacji pisze `./schema`,
    // bo rozszerzenie dokłada bundler. Node wymaga pełnej nazwy pliku.
    if (specifier.startsWith('.') && context.parentURL !== undefined) {
      const katalog = fileURLToPath(new URL('.', context.parentURL))
      const trafiony = znajdz(resolve(katalog, specifier))
      if (trafiony !== undefined) return { url: pathToFileURL(trafiony).href, shortCircuit: true }
    }

    return nextResolve(specifier, context)
  },
})
