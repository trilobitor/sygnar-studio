'use client'

import { useState } from 'react'

import { EmptyState, Hint } from '@/components/ui/primitives'
import { FIELD_HINTS } from '@/lib/messages'
import type { Asset } from '@/types/api'

/**
 * Galeria wariantów (SPEC §10).
 *
 * Przy każdym kadrze widać numer losowania — bez niego grafik nie poprosi
 * o poprawkę tego samego ujęcia. Kroków, guidance ani nazwy modelu nie widzi.
 *
 * Miniatury ładują się leniwie, a lista rośnie porcjami, żeby sto kadrów
 * nie zabiło przeglądarki na laptopie.
 */

const PAGE_SIZE = 24

export function Gallery({
  assets,
  selectedId,
  onSelect,
}: {
  assets: Asset[]
  selectedId: string | null
  onSelect: (asset: Asset) => void
}) {
  const [visible, setVisible] = useState(PAGE_SIZE)

  const images = assets.filter(
    (asset) => asset.kind === 'generated' || asset.kind === 'uploaded',
  )

  if (images.length === 0) {
    return (
      <EmptyState>
        Nie ma tu jeszcze żadnego kadru. Kliknij <strong>Nowy brief</strong>, opisz, co ma być
        na obrazie, i policzymy kilka podejść.
      </EmptyState>
    )
  }

  const shown = images.slice(0, visible)

  return (
    <div className="flex flex-col gap-3">
      {/* Objaśnienie numeru losowania stoi raz nad siatką, nie przy każdym
          kadrze — kafelek jest przyciskiem, a przycisk w przycisku nie działa. */}
      <p className="flex items-baseline text-xs text-ink-muted">
        Pod każdym kadrem jest numer losowania
        <Hint text={FIELD_HINTS.seed} />
      </p>

      <div className="grid grid-cols-4 gap-3">
        {shown.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onSelect(asset)}
            aria-label={`Kadr z numerem losowania ${asset.seed ?? 'nieznanym'}`}
            aria-pressed={selectedId === asset.id}
            className={`group overflow-hidden rounded border text-left transition ${
              selectedId === asset.id ? 'border-accent' : 'border-line hover:border-ink-muted'
            }`}
          >
            <div className="checkerboard aspect-4/3">
              {asset.mime.startsWith('video/') ? (
                /*
                 * Klatka klipu jako **obrazek**, nie element `<video>`.
                 *
                 * Wersja z `<video preload="metadata">` okazała się po dodaniu
                 * obsługi `Range` gorsza niż stan wyjściowy: przeglądarka
                 * wysyłała 29 żądań częściowych i ściągała 228 MB przy galerii
                 * ważącej 46 MB. Zmierzone, nie oszacowane.
                 */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/files/${asset.id}?miniatura`}
                  alt="Pierwsza klatka wgranego klipu"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <>
                  {/* Zwykły `img`, bo pliki serwuje nasz własny endpoint po ID
                      i nie chcemy ich przepuszczać przez optymalizator. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                      // Miniatura, nie pełny plik: kafelek ma 320 px, a kadr
                      // z mfluxa waży 1,6 MB. Zmierzone przed zmianą — jedno
                      // zlecenie to 46 MB przy każdym otwarciu galerii.
                    src={`/api/files/${asset.id}?miniatura`}
                    // Wgrany plik nie jest „wygenerowanym kadrem o nieznanym
                    // numerze losowania" — to zdanie myliło czytnik ekranu
                    // i nie odróżniało dwóch zupełnie różnych rzeczy.
                    alt={
                      asset.seed === null
                        ? 'Wgrany plik'
                        : `Kadr, numer losowania ${asset.seed}`
                    }
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </>
              )}
            </div>
            <div className="px-2 py-1.5 text-xs text-ink-muted">
              {asset.seed === null ? (
                'plik wgrany'
              ) : (
                <span>nr losowania {asset.seed}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {visible < images.length && (
        <button
          type="button"
          onClick={() => setVisible((value) => value + PAGE_SIZE)}
          className="self-center text-sm text-accent"
        >
          Pokaż kolejne ({images.length - visible})
        </button>
      )}
    </div>
  )
}

/** Duży podgląd wybranego kadru na neutralnym tle, bez cieni i gradientów. */
export function Preview({ asset }: { asset: Asset | null }) {
  if (asset === null) {
    return (
      <div className="flex flex-1 items-center justify-center rounded border border-line text-sm text-ink-muted">
        Wybierz kadr z listy poniżej, żeby zobaczyć go w powiększeniu.
      </div>
    )
  }

  const isVideo = asset.mime.startsWith('video/')

  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden rounded border border-line bg-surface-0">
      {isVideo ? (
        <video src={`/api/files/${asset.id}`} controls className="max-h-full max-w-full" />
      ) : (
        // Szachownica siedzi dokładnie pod obrazem, nie wokół niego — inaczej
        // wzór wchodziłby w pole widzenia przy ocenie koloru (SPEC §10).
        <span className="checkerboard inline-flex max-h-full max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/files/${asset.id}`}
            alt="Podgląd wybranego kadru"
            className="max-h-full max-w-full object-contain"
          />
        </span>
      )}
    </div>
  )
}
