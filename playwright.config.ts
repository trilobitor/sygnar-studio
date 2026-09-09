import { defineConfig, devices } from '@playwright/test'

/**
 * Scenariusze end-to-end (SPEC §14) — maksymalnie pięć, lista zamknięta.
 *
 * Testy uderzają w prawdziwą stację: generowanie kadru trwa około pół minuty
 * na wariant, więc limity czasu są hojne, a testy idą jeden po drugim.
 * Dwa równoległe zadania GPU wyczerpałyby pamięć maszyny.
 */
export default defineConfig({
  testDir: './e2e',
  // Kolejka przepuszcza jedno zadanie GPU naraz — równoległość testów
  // dałaby tylko dłuższe oczekiwanie i mylące wyniki.
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    locale: 'pl-PL',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
