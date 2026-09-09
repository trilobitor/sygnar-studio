import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

/**
 * Scenariusze end-to-end (SPEC §14) — maksymalnie pięć, lista zamknięta.
 *
 * Testy uderzają w prawdziwą stację: generowanie kadru trwa około pół minuty
 * na wariant, więc limity czasu są hojne, a testy idą jeden po drugim.
 * Dwa równoległe zadania GPU wyczerpałyby pamięć maszyny.
 *
 * **Osobne dane i osobny port.** Wcześniej `command: 'npm run start'` brał
 * produkcyjny `.env`, a `reuseExistingServer: true` podpinał się do serwera
 * grafika — testy zakładały zlecenia w jego bazie i nic ich nie sprzątało.
 * Teraz katalog danych jest tymczasowy, port inny niż produkcyjny, a serwer
 * nigdy nie jest współdzielony.
 *
 * Bramka logowania jest w E2E wyłączona jawnie (`STUDIO_REQUIRE_LOGIN=0`),
 * bo scenariusze sprawdzają pracę z panelem, nie logowanie — to ostatnie ma
 * własne testy jednostkowe.
 */
const PORT = 3100
// Ścieżka bezwzględna, bo `env.ts` wymaga tego od `STUDIO_DATA_DIR` —
// względna zatrzymuje start z komunikatem o niekompletnej konfiguracji.
const DANE = join(process.cwd(), '.e2e-dane')

export default defineConfig({
  testDir: './e2e',
  // Kolejka przepuszcza jedno zadanie GPU naraz — równoległość testów
  // dałaby tylko dłuższe oczekiwanie i mylące wyniki.
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './e2e/przygotowanie.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'pl-PL',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `STUDIO_DATA_DIR=${DANE} STUDIO_REQUIRE_LOGIN=0 npm run start -- -p ${PORT}`,
    // `/api/zyje` zamiast `/api/health`: to drugie stoi za bramką i przy
    // włączonym logowaniu zwraca 401, więc serwer nigdy nie zostałby uznany
    // za gotowy.
    url: `http://127.0.0.1:${PORT}/api/zyje`,
    // Nigdy nie podpinamy się do cudzego serwera — patrz komentarz wyżej.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
