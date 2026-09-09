import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Aliasy `@/*` bierzemy z tsconfig.json — bez dodatkowej wtyczki.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],

    /*
     * Pokrycie mierzymy tam, gdzie SPEC §14 wymaga testów, i tylko tam.
     *
     * Progi są **dolną granicą tego, co już jest**, nie ambicją — mają
     * wychwycić cofnięcie się, a nie wymuszać pisanie testów do liczby.
     * Komponenty i trasy pomijamy: sprawdzamy je w przeglądarce i przez
     * scenariusze E2E, gdzie liczy się zachowanie, nie linie kodu.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: [
        'src/lib/**/*.ts',
        'src/server/services/**/*.ts',
        'src/server/queue/**/*.ts',
        'src/server/adapters/**/*.ts',
      ],
      exclude: ['**/*.test.ts', 'src/server/db/migrations/**'],

      // Zmierzone przy wprowadzaniu: 56,9 / 50,8 / 61,3 / 58,0. Progi stoją
      // tuż poniżej, żeby łapać cofnięcie się, a nie blokować pracę.
      thresholds: {
        statements: 55,
        branches: 48,
        functions: 58,
        lines: 55,
      },
    },
    // Testy dotykają tej samej bazy SQLite, więc idą jeden plik po drugim.
    fileParallelism: false,
  },
})
