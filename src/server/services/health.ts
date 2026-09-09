import { checkDarktable } from '@/server/adapters/darktable'
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

export const ADAPTER_NAMES = ['generator', 'video', 'export', 'photos'] as const
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
   * Czy da się pracować. Generowanie jest krytyczne, reszta nie —
   * brak darktable nie może blokować całej aplikacji.
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
}

export async function collectHealth(): Promise<HealthReport> {
  const [generator, video, exporter, photos] = await Promise.all([
    checkMflux(),
    checkFfmpeg(),
    checkSharp(),
    checkDarktable(),
  ])

  const statuses: Record<AdapterName, HealthStatus> = {
    generator,
    video,
    export: exporter,
    photos,
  }

  const adapters = ADAPTER_NAMES.map((name) => ({
    name,
    label: LABELS[name],
    status: statuses[name],
  }))

  return {
    ready: generator.ok && exporter.ok,
    adapters,
    checkedAt: Date.now(),
  }
}
