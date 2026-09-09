import { statfs, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'

import { env } from '@/lib/env'
import { db } from '@/server/db/client'
import { checkClaudeCli } from '@/server/adapters/claude-cli'
import { checkDarktable } from '@/server/adapters/darktable'
import { checkPrompt } from '@/server/adapters/prompt'
import { checkFfmpeg } from '@/server/adapters/ffmpeg'
import { checkMflux } from '@/server/adapters/mflux'
import { checkSharp } from '@/server/adapters/sharp'
import type { HealthStatus } from '@/server/adapters/types'

/**
 * Stan adapterów pod baner w interfejsie (SPEC §8).
 *
 * Warstwa serwisów nie importuje niczego z `next/*` — ma dać się przetestować
 * bez uruchamiania frameworka.
 */

export const ADAPTER_NAMES = ['generator', 'video', 'export', 'photos', 'opis', 'baza', 'dysk'] as const
export type AdapterName = (typeof ADAPTER_NAMES)[number]

export interface AdapterHealth {
  /** Nazwa techniczna, używana w kodzie i w logu. */
  name: AdapterName
  /** Etykieta dla grafika. Bez słów „ComfyUI", „mflux" i „darktable". */
  label: string
  status: HealthStatus
}

export interface HealthReport {
  /**
   * Czy da się pracować. Krytyczne są generowanie, eksport, baza i dysk —
   * brak darktable nie może blokować całej aplikacji, ale martwa baza owszem.
   */
  ready: boolean
  adapters: AdapterHealth[]
  checkedAt: number
}

const LABELS: Record<AdapterName, string> = {
  generator: 'Generowanie obrazów',
  video: 'Montaż wideo',
  export: 'Eksport plików',
  photos: 'Obróbka wsadowa zdjęć',
  opis: 'Przygotowanie opisu',
  baza: 'Baza zleceń',
  dysk: 'Katalog danych',
}

/**
 * Czy baza odpowiada.
 *
 * Doświadczenie z audytu: `studio.db` wypełniony losowymi bajtami dawał
 * `/api/health` = `{"ready":true}`, podczas gdy `/api/orders` w tej samej
 * sekundzie zwracało 500. Baner mówił „stacja jest wolna", a panel nie
 * potrafił wyświetlić ani jednego zlecenia.
 */
async function sprawdzBaze(): Promise<HealthStatus> {
  try {
    db.get(sql`select count(*) as ile from orders`)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

/**
 * Czy warstwa przygotowująca opis jest gotowa.
 *
 * Backend wybiera `PROMPT_BACKEND`. Awaria tej warstwy nie blokuje pracy —
 * składacz deterministyczny działa zawsze — więc pozycja jest informacyjna
 * i nie wchodzi do `ready`.
 */
async function sprawdzOpis(): Promise<HealthStatus> {
  if (env.PROMPT_BACKEND === 'builder') return { ok: true, version: 'składacz' }
  if (env.PROMPT_BACKEND === 'api') return await checkPrompt()
  if (env.PROMPT_BACKEND === 'cli') return await checkClaudeCli()

  // `auto`: wystarczy, że działa którakolwiek droga.
  const cli = await checkClaudeCli()
  if (cli.ok) return cli

  const api = await checkPrompt()
  return api.ok ? api : { ok: true, version: 'składacz' }
}

/** Ile miejsca zostało — poniżej tego progu jeden montaż potrafi zapchać dysk. */
const MIN_WOLNE_BAJTY = 2 * 1024 * 1024 * 1024

/** Czy katalog danych da się zapisywać i czy jest na czym. */
async function sprawdzDysk(): Promise<HealthStatus> {
  // Prawdziwa próba zapisu, nie samo `access(W_OK)`. Bit uprawnień potrafi
  // być ustawiony tam, gdzie zapis i tak padnie: nośnik zamontowany tylko do
  // odczytu, pełny dysk, reguła ACL. Zdrowie ma mówić, czy da się pracować,
  // a nie czy teoretycznie wolno.
  const probka = join(env.STUDIO_DATA_DIR, '.probka-zapisu')

  try {
    await writeFile(probka, 'x')
    await unlink(probka)
  } catch {
    return { ok: false, reason: 'misconfigured' }
  }

  try {
    const st = await statfs(env.STUDIO_DATA_DIR)
    const wolne = st.bsize * st.bavail

    if (wolne < MIN_WOLNE_BAJTY) {
      return { ok: false, reason: 'misconfigured' }
    }

    return { ok: true, version: `${Math.round(wolne / 1024 / 1024 / 1024)} GB wolnego` }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

export async function collectHealth(): Promise<HealthReport> {
  const [generator, video, exporter, photos, opis, baza, dysk] = await Promise.all([
    checkMflux(),
    checkFfmpeg(),
    checkSharp(),
    checkDarktable(),
    // Warstwa promptowa miała dwie gotowe funkcje sprawdzające i żadna nie
    // była nigdzie wołana — grafik dowiadywał się o awarii dopiero wtedy,
    // gdy okno briefu wracało z pustym opisem.
    sprawdzOpis(),
    sprawdzBaze(),
    sprawdzDysk(),
  ])

  const statuses: Record<AdapterName, HealthStatus> = {
    generator,
    video,
    export: exporter,
    photos,
    opis,
    baza,
    dysk,
  }

  const adapters = ADAPTER_NAMES.map((name) => ({
    name,
    label: LABELS[name],
    status: statuses[name],
  }))

  return {
    // Baza i dysk są krytyczne tak samo jak generator: bez nich panel nie
    // wyświetli zlecenia ani nie zapisze pliku, choćby mflux stał gotowy.
    ready: generator.ok && exporter.ok && baza.ok && dysk.ok,
    adapters,
    checkedAt: Date.now(),
  }
}
