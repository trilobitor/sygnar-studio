"use client";

import { useState } from "react";

import { EmptyState, Hint } from "@/components/ui/primitives";
import { FIELD_HINTS } from "@/lib/messages";
import type { Asset } from "@/types/api";

/**
 * Galeria wariantów (SPEC §10).
 *
 * Przy każdym kadrze widać numer losowania — bez niego grafik nie poprosi
 * o poprawkę tego samego ujęcia. Kroków, guidance ani nazwy modelu nie widzi.
 *
 * Miniatury ładują się leniwie, a lista rośnie porcjami, żeby sto kadrów
 * nie zabiło przeglądarki na laptopie.
 */

const PAGE_SIZE = 24;

export function Gallery({
  assets,
  selectedId,
  onSelect,
  onChanged,
}: {
  assets: Asset[];
  selectedId: string | null;
  onSelect: (asset: Asset) => void;
  /** Wołane po odłożeniu kadru na bok — lista musi się przeładować. */
  onChanged: () => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  /**
   * Filtr „tylko odłożone".
   *
   * Kolumna `starred` istniała w bazie od pierwszej migracji i nie miała ani
   * endpointu, ani interfejsu — przy ośmiu wariantach grafik musiał zapamiętać
   * wybrany kadr albo zapisać jego numer losowania gdzieś obok panelu.
   */
  const [tylkoOdlozone, setTylkoOdlozone] = useState(false);

  async function przelaczOdlozenie(asset: Asset): Promise<void> {
    await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: asset.starred !== 1 }),
    }).catch(() => {});

    onChanged();
  }

  const images = assets
    .filter((asset) => asset.kind === "generated" || asset.kind === "uploaded")
    .filter((asset) => !tylkoOdlozone || asset.starred === 1);

  if (images.length === 0) {
    return (
      <EmptyState>
        Nie ma tu jeszcze żadnego kadru. Kliknij <strong>Nowy brief</strong>,
        opisz, co ma być na obrazie, i policzymy kilka podejść.
      </EmptyState>
    );
  }

  const shown = images.slice(0, visible);

  return (
    <div className="flex flex-col gap-3">
      {/* Objaśnienie numeru losowania stoi raz nad siatką, nie przy każdym
          kadrze — kafelek jest przyciskiem, a przycisk w przycisku nie działa. */}
      <div className="flex items-baseline justify-between">
        <p className="flex items-baseline text-xs text-ink-muted">
          Pod każdym kadrem jest numer losowania
          <Hint text={FIELD_HINTS.seed} />
        </p>

        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={tylkoOdlozone}
            onChange={(event) => setTylkoOdlozone(event.target.checked)}
          />
          Tylko odłożone
        </label>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {shown.map((asset) => (
          // Gwiazdka stoi **obok** kafelka, nie w nim: kafelek jest przyciskiem,
          // a przycisk w przycisku nie działa.
          <div
            key={asset.id}
            // `content-visibility` pozwala przeglądarce pominąć układanie
            // kafelków poza widokiem. Przy kilkudziesięciu kadrach różnica
            // jest odczuwalna, a kosztuje jedną właściwość — pełna
            // wirtualizacja wymagałaby biblioteki i własnego przewijania.
            className="relative [content-visibility:auto] [contain-intrinsic-size:auto_180px]"
          >
            <button
              type="button"
              onClick={() => void przelaczOdlozenie(asset)}
              aria-pressed={asset.starred === 1}
              aria-label={
                asset.starred === 1
                  ? "Zdejmij oznaczenie kadru"
                  : "Odłóż ten kadr na bok"
              }
              className={`absolute right-1 top-1 z-10 rounded px-1.5 py-0.5 text-sm transition ${
                asset.starred === 1
                  ? "bg-surface-0/80 text-accent"
                  : "bg-surface-0/60 text-ink-muted opacity-0 hover:text-accent focus:opacity-100 group-hover:opacity-100"
              }`}
            >
              {asset.starred === 1 ? "★" : "☆"}
            </button>

            <button
              type="button"
              onClick={() => onSelect(asset)}
              aria-label={`Kadr z numerem losowania ${asset.seed ?? "nieznanym"}`}
              aria-pressed={selectedId === asset.id}
              className={`group overflow-hidden rounded border text-left transition ${
                selectedId === asset.id
                  ? "border-accent"
                  : "border-line hover:border-ink-muted"
              }`}
            >
              <div className="checkerboard aspect-4/3">
                {asset.mime.startsWith("video/") ? (
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
                          ? "Wgrany plik"
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
                  "plik wgrany"
                ) : (
                  <span>nr losowania {asset.seed}</span>
                )}
              </div>
            </button>
          </div>
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
  );
}

/** Duży podgląd wybranego kadru na neutralnym tle, bez cieni i gradientów. */
export function Preview({ asset }: { asset: Asset | null }) {
  if (asset === null) {
    return (
      <div className="flex flex-1 items-center justify-center rounded border border-line text-sm text-ink-muted">
        Wybierz kadr z listy poniżej, żeby zobaczyć go w powiększeniu.
      </div>
    );
  }

  const isVideo = asset.mime.startsWith("video/");

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded border border-line bg-surface-0">
      {/*
        Pobranie oglądanego pliku.
        Kadru ani wgranego pliku nie dało się pobrać wcale — służyły wyłącznie
        do oglądania. Grafik, który chciał wysłać klientowi surowy kadr do
        akceptacji, robił zrzut ekranu albo szukał pliku na dysku.
      */}
      <a
        href={`/api/files/${asset.id}?pobierz`}
        download
        title="Pobierz ten plik"
        className="absolute right-2 top-2 z-10 rounded bg-surface-0/80 px-2 py-1 text-xs text-ink-muted transition hover:text-ink"
      >
        Pobierz
      </a>

      {isVideo ? (
        /*
         * Napisów tu nie będzie i nie da się ich mieć: to podgląd klipu, który grafik
         * przed chwilą sam wgrał na swoją maszynę, a nie materiał publikowany. Pusty
         * <track> byłby gorszy niż brak — obiecywałby czytnikowi treść, której nie ma.
         */
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={`/api/files/${asset.id}`}
          controls
          className="max-h-full max-w-full"
        />
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
  );
}
