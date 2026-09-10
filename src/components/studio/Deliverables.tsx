'use client'

import { EmptyState, RowMenu } from '@/components/ui/primitives'
import { brakujaceFormaty, sprawdzPlik } from '@/server/services/quality-check'
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

export function Deliverables({
  assets,
  orderId,
  onChanged,
}: {
  assets: Asset[]
  orderId: string
  /** Wołane po skasowaniu pliku — lista musi się przeładować. */
  onChanged: () => void
}) {
  /**
   * Skasowanie gotowego pliku.
   *
   * Eksport zapisany z niewłaściwym presetem albo z kadru, który się nie
   * nadaje, zostawał na liście do oddania na zawsze — a paczka ZIP bierze
   * wszystko, co na niej stoi. Pytamy przed skasowaniem: pliku nie da się
   * odzyskać, ale sam kadr źródłowy zostaje i można wyeksportować ponownie.
   */
  async function skasuj(plik: Asset): Promise<void> {
    if (!globalThis.confirm(`Skasować ${nazwaPliku(plik.path)}? Kadr źródłowy zostaje.`)) return

    await fetch(`/api/assets/${plik.id}`, { method: 'DELETE' }).catch(() => {})
    onChanged()
  }

  const pliki = assets.filter((a) => a.kind === 'export' || a.kind === 'poster')

  /*
   * Kontrola przed oddaniem — wyłącznie z liczb, które aplikacja już zapisuje.
   * Dotąd eksport zapisany na granicy jakości kończył się tak samo, na zielono,
   * jak eksport idealny. Liczy się w przeglądarce: serwis jest czysty, a dane
   * już tu są.
   */
  const zastrzezenia = new Map(pliki.map((plik) => [plik.id, sprawdzPlik(plik)]))
  const naCalosci = brakujaceFormaty(pliki)
  const ileUwag = [...zastrzezenia.values()].reduce((suma, lista) => suma + lista.length, 0) +
    naCalosci.length

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-ink-muted">
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
            <li key={plik.id} className="group/plik">
              <div className="flex items-baseline gap-2 rounded px-2 py-1.5 text-xs transition hover:bg-surface-2">
                <a
                  href={`/api/files/${plik.id}`}
                  download
                  className="min-w-0 flex-1 truncate text-ink"
                  title={nazwaPliku(plik.path)}
                >
                  {nazwaPliku(plik.path)}
                </a>
                <span className="shrink-0 text-ink-muted">{rodzaj(plik)}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{waga(plik.bytes)}</span>

                {/* Menu wiersza — te same trzy kropki co przy zleceniach,
                    żeby nie było dwóch różnych sposobów na to samo. */}
                <span className="shrink-0 opacity-0 transition group-hover/plik:opacity-100 focus-within:opacity-100">
                  <RowMenu
                    label={`Więcej opcji dla pliku ${nazwaPliku(plik.path)}`}
                    items={[
                      {
                        // Pobieranie jest już pod kliknięciem w nazwę, więc
                        // menu daje to, czego kliknięciem zrobić się nie da.
                        label: 'Kopiuj nazwę pliku',
                        onSelect: () => {
                          void navigator.clipboard.writeText(nazwaPliku(plik.path))
                        },
                      },
                      {
                        label: 'Skasuj plik',
                        danger: true,
                        onSelect: () => void skasuj(plik),
                      },
                    ]}
                  />
                </span>
              </div>

              {(zastrzezenia.get(plik.id) ?? []).map((uwaga) => (
                <p key={uwaga.kod} className="px-2 pb-1 text-xs text-danger">
                  {uwaga.tresc}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}

      {naCalosci.map((uwaga) => (
        <p key={uwaga.tresc} className="px-2 text-xs text-danger">
          {uwaga.tresc}
        </p>
      ))}

      {pliki.length > 0 && (
        <>
          {ileUwag === 0 && (
            /* Ostrożnie z tym zdaniem: aplikacja obrazu nie widzi (SPEC §7a)
               i nie ma prawa twierdzić, że jest dobry. Mówi tylko o liczbach. */
            <p className="px-2 text-xs text-ink-muted">
              Wymiary, formaty i jakość zgadzają się z tabelą. Sam obraz oceń wzrokiem.
            </p>
          )}

          <a
            href={`/api/orders/${orderId}/paczka`}
            download
            className="rounded border border-field px-2 py-1.5 text-center text-xs text-ink transition hover:border-ink-muted"
          >
            Pobierz wszystko jednym plikiem
          </a>
        </>
      )}
    </section>
  )
}
