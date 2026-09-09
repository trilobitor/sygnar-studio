import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Aliasy `@/*` bierzemy z tsconfig.json — bez dodatkowej wtyczki.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    // Testy dotykają tej samej bazy SQLite, więc idą jeden plik po drugim.
    fileParallelism: false,
  },
})
