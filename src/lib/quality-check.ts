import { OUTPUT_PRESETS } from '@/lib/output-presets'
import type { Asset } from '@/server/db/schema'

/**
 * Kontrola przed oddaniem — wyłącznie z faktów.
 *
 * SPEC §7a zabrania aplikacji chwalenia wyniku, bo ona obrazu nie widzi.
 * Ale liczby widzi doskonale i już je zapisuje: jakość dobraną przez sharpa,
 * wymiar, wagę, format. Dotąd eksport zapisany na granicy jakości kończył się
 * tak samo — na zielono — jak eksport idealny.
 *
 * Warstwa serwisów nie importuje niczego z `next/*`, więc to się testuje bez
 * uruchamiania frameworka.
 */

/** Poniżej tej jakości JPEG i WebP zaczynają widocznie się sypać. */
export const PROG_JAKOSCI = 45

export interface Zastrzezenie {
  /** Kod do rozpoznania w kodzie i w testach. */
  kod: 'jakosc' | 'wymiar' | 'format' | 'pusty' | 'brak-presetu'
  /** Zdanie dla grafika — mówi, co jest nie tak i co z tym zrobić. */
  tresc: string
}

function odczytajMetadane(raw: string | null): Record<string, unknown> {
  if (raw === null) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
  } catch {
    return {}
  }
}

/**
 * Zastrzeżenia do pojedynczego pliku do oddania.
 *
 * Pusta lista znaczy „nic do zarzucenia z tego, co da się zmierzyć" — a nie
 * „obraz jest dobry". Tej drugiej rzeczy aplikacja nie wie i nie ma prawa
 * twierdzić.
 */
export function sprawdzPlik(asset: Asset): Zastrzezenie[] {
  const uwagi: Zastrzezenie[] = []
  const metadane = odczytajMetadane(asset.metadataJson)

  if (asset.bytes === 0) {
    uwagi.push({
      kod: 'pusty',
      tresc: 'Plik ma zero bajtów. Zapisz go jeszcze raz.',
    })

    // Przy pustym pliku reszta pomiarów nic nie znaczy.
    return uwagi
  }

  const quality = metadane.quality
  if (typeof quality === 'number' && quality < PROG_JAKOSCI) {
    uwagi.push({
      kod: 'jakosc',
      tresc: `Plik zszedł do jakości ${String(quality)}, żeby zmieścić się w limicie wagi. Przy tej wartości widać artefakty — rozważ lżejszy kadr albo wyższy limit.`,
    })
  }

  const purpose = metadane.purpose
  if (typeof purpose !== 'string') {
    uwagi.push({
      kod: 'brak-presetu',
      tresc: 'Nie wiadomo, do którego miejsca ten plik jest przeznaczony — nie da się sprawdzić wymiaru ani formatu.',
    })

    return uwagi
  }

  const preset = OUTPUT_PRESETS[purpose as keyof typeof OUTPUT_PRESETS]

  if (preset === undefined) {
    uwagi.push({
      kod: 'brak-presetu',
      tresc: `Miejsce docelowe „${purpose}" nie istnieje w tabeli formatów.`,
    })

    return uwagi
  }

  if (asset.width !== preset.deliver.width || asset.height !== preset.deliver.height) {
    uwagi.push({
      kod: 'wymiar',
      tresc: `Wymiar ${String(asset.width)} × ${String(asset.height)} nie zgadza się z oczekiwanym ${String(preset.deliver.width)} × ${String(preset.deliver.height)} dla miejsca „${preset.label}".`,
    })
  }

  const rozszerzenie = asset.mime.split('/')[1]
  const dopuszczone: readonly string[] = preset.formats

  if (rozszerzenie !== undefined && !dopuszczone.includes(rozszerzenie)) {
    uwagi.push({
      kod: 'format',
      tresc: `Format ${rozszerzenie.toUpperCase()} nie jest na liście dla miejsca „${preset.label}" (dopuszczone: ${dopuszczone.map((f) => f.toUpperCase()).join(', ')}).`,
    })
  }

  return uwagi
}

/**
 * Czy komplet formatów wymaganych przez preset został zapisany.
 *
 * Sprawdzane na całym zestawie, nie na pojedynczym pliku: brak WebP obok
 * AVIF-a widać dopiero wtedy, gdy patrzy się na wszystkie pliki danego miejsca.
 */
export function brakujaceFormaty(pliki: Asset[]): Zastrzezenie[] {
  const wedlugMiejsca = new Map<string, Set<string>>()

  for (const plik of pliki) {
    const purpose = odczytajMetadane(plik.metadataJson).purpose
    if (typeof purpose !== 'string') continue

    const rozszerzenie = plik.mime.split('/')[1]
    if (rozszerzenie === undefined) continue

    const zestaw = wedlugMiejsca.get(purpose) ?? new Set<string>()
    zestaw.add(rozszerzenie)
    wedlugMiejsca.set(purpose, zestaw)
  }

  const uwagi: Zastrzezenie[] = []

  for (const [purpose, obecne] of wedlugMiejsca) {
    const preset = OUTPUT_PRESETS[purpose as keyof typeof OUTPUT_PRESETS]
    if (preset === undefined) continue

    const brakuje = preset.formats.filter((format) => !obecne.has(format))

    if (brakuje.length > 0) {
      uwagi.push({
        kod: 'format',
        tresc: `Dla miejsca „${preset.label}" brakuje formatów: ${brakuje.map((f) => f.toUpperCase()).join(', ')}.`,
      })
    }
  }

  return uwagi
}
