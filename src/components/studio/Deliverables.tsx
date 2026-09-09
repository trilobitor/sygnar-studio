'use client'

import { EmptyState } from '@/components/ui/primitives'
import type { Asset } from '@/types/api'

/**
 * Lista plików gotowych do oddania.
 *
 * Bez niej aplikacja nie domykała swojej pętli: eksporty i zmontowane wideo
 * powstawały poprawnie i lądowały na dysku Maca, ale galeria przepuszczała
 * wyłącznie kadry wygenerowane i wgrane, a w całym interfejsie nie było ani
 * jednego odnośnika do pobrania. Grafik pracujący z Windowsa przez sieć
 * prywatną nie miał żadnej drogi do odebrania własnej pracy.
 *
 * Lista dotyczy całego zlecenia, nie zaznaczonego kadru — dlatego siedzi
 * osobno, pod panelem kontekstowym, i jest widoczna cały czas.
 */

/** Nazwa pliku bez katalogów. Ścieżka w bazie jest względna wobec katalogu danych. */
function nazwaPliku(path: string): string {
  return path.split('/').pop() ?? path
}

function waga(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Ikona zależna od tego, czy to obraz, wideo, czy plansza. */
function rodzaj(asset: Asset): string {
  if (asset.mime.startsWith('video/')) return 'wideo'
  if (asset.kind === 'poster') return 'plansza'
  return asset.mime.replace('image/', '').toUpperCase()
}

export function Deliverables({ assets }: { assets: Asset[] }) {
  const pliki = assets.filter((a) => a.kind === 'export' || a.kind === 'poster')

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="flex items-baseline justify-between text-sm font-medium text-ink">
        Do oddania
        {pliki.length > 0 && <span className="text-xs text-ink-muted">{pliki.length}</span>}
      </h3>

      {pliki.length === 0 ? (
        <EmptyState>
          Nic jeszcze nie jest gotowe. Zaznacz kadr i kliknij <strong>Zapisz plik do oddania</strong>.
        </EmptyState>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {pliki.map((plik) => (
            <li key={plik.id}>
              <a
                href={`/api/files/${plik.id}`}
                download
                className="flex items-baseline justify-between gap-2 rounded px-2 py-1.5 text-xs transition hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{nazwaPliku(plik.path)}</span>
                <span className="shrink-0 text-ink-muted">{rodzaj(plik)}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{waga(plik.bytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
