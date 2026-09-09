"use client";

import { useEffect, useState } from "react";

import { EmptyState, Hint } from "@/components/ui/primitives";
import { FIELD_HINTS } from "@/lib/messages";
import { OUTPUT_PRESETS } from "@/lib/output-presets";
import type { Asset } from "@/types/api";

import { Lightbox } from "./Lightbox";

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
              /*
                Zaznaczenie neutralną obwódką, nie akcentem marki. SPEC §10 dopuszcza
                ciepły mosiądz wyłącznie na przyciskach akcji i stanach aktywnych —
                właśnie dlatego, że nasycony kolor tuż przy kadrze psuje ocenę barw.
                `outline-offset` zostawia ciemną szparę między obwódką a obrazem.
              */
              className={`group overflow-hidden rounded border text-left transition ${
                selectedId === asset.id
                  ? "border-line outline-2 outline-offset-1 outline-ink"
                  : "border-line hover:border-ink-muted"
              }`}
            >
              {/* Szachownica tylko pod PNG: pod nieprzezroczystym JPEG-iem jest
                  wyłącznie szumem wokół obrazu. */}
              <div
                className={`aspect-4/3 ${asset.mime === "image/png" ? "checkerboard" : "bg-surface-0"}`}
              >
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
/** Waga pliku w jednostce, którą grafik rozpozna z Findera. */
function waga(bajty: number): string {
  return bajty < 1024 * 1024
    ? `${String(Math.round(bajty / 1024))} KB`
    : `${(bajty / 1024 / 1024).toFixed(1)} MB`;
}

/** Data w formie „dziś 14:07" albo „8 września 14:07". */
function kiedy(znacznik: number): string {
  const data = new Date(znacznik);
  const godzina = data.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const dzis = new Date().toDateString() === data.toDateString();

  return dzis
    ? `dziś ${godzina}`
    : `${data.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })} ${godzina}`;
}

/**
 * Wąski pasek z faktami o kadrze.
 *
 * Duży podgląd pokazywał sam obraz i nic poza nim. Wymiary, waga, numer
 * losowania i przeznaczenie były w bazie i przychodziły do przeglądarki
 * w obiekcie `Asset`, ale nie pojawiała się ani jedna z tych wartości —
 * numer losowania widniał wyłącznie w podpisie kafelka, więc po przewinięciu
 * galerii znikał z pola widzenia.
 */
function FaktyOKadrze({ asset }: { asset: Asset }) {
  const [skopiowane, setSkopiowane] = useState(false);
  const przeznaczenie = odczytajPrzeznaczenie(asset.metadataJson);

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-ink-muted">
      <span>
        {asset.width} × {asset.height}
      </span>
      <span aria-hidden="true">·</span>
      <span>{waga(asset.bytes)}</span>

      {asset.seed !== null && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            title="Skopiuj numer losowania"
            className="underline decoration-dotted underline-offset-2 hover:text-ink"
            onClick={() => {
              void navigator.clipboard.writeText(String(asset.seed)).then(() => {
                setSkopiowane(true);
                setTimeout(() => setSkopiowane(false), 1500);
              });
            }}
          >
            nr losowania {asset.seed}
          </button>
          {skopiowane && <span className="text-ink">skopiowane</span>}
        </>
      )}

      {przeznaczenie !== null && (
        <>
          <span aria-hidden="true">·</span>
          <span>{przeznaczenie}</span>
        </>
      )}

      <span aria-hidden="true">·</span>
      <span>{kiedy(asset.createdAt)}</span>
    </p>
  );
}

/** Etykieta przeznaczenia z metadanych kadru. `null`, gdy kadr jej nie niesie. */
function odczytajPrzeznaczenie(raw: string | null): string | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const purpose = Reflect.get(parsed, "purpose");
    if (typeof purpose !== "string") return null;

    return OUTPUT_PRESETS[purpose as keyof typeof OUTPUT_PRESETS]?.label ?? null;
  } catch {
    return null;
  }
}

export function Preview({ asset }: { asset: Asset | null }) {
  const [pelnyEkran, setPelnyEkran] = useState(false);

  /*
   * Klawisz `F` otwiera podgląd pełnoekranowy. Nasłuch stoi tutaj, a nie
   * w nakładce, bo nakładki wtedy jeszcze nie ma. Pomijamy go, gdy grafik
   * pisze w polu tekstowym — inaczej „f" w opisie sceny otwierałoby okno.
   */
  useEffect(() => {
    function klawisz(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "f" || event.metaKey || event.ctrlKey) return;

      const cel = event.target;
      if (
        cel instanceof HTMLElement &&
        (cel.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(cel.tagName))
      ) {
        return;
      }

      if (asset !== null && !asset.mime.startsWith("video/")) {
        event.preventDefault();
        setPelnyEkran(true);
      }
    }

    window.addEventListener("keydown", klawisz);
    return () => window.removeEventListener("keydown", klawisz);
  }, [asset]);

  if (asset === null) {
    return (
      <div className="flex flex-1 items-center justify-center rounded border border-line text-sm text-ink-muted">
        Wybierz kadr z listy poniżej, żeby zobaczyć go w powiększeniu.
      </div>
    );
  }

  const isVideo = asset.mime.startsWith("video/");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
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
        <span
          className={`inline-flex max-h-full max-w-full ${
            asset.mime === "image/png" ? "checkerboard" : ""
          }`}
          onDoubleClick={() => setPelnyEkran(true)}
          title="Dwuklik albo klawisz F — podgląd na cały ekran"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/files/${asset.id}`}
            alt="Podgląd wybranego kadru"
            className="max-h-full max-w-full object-contain"
          />
        </span>
      )}

      {pelnyEkran && !isVideo && (
        <Lightbox asset={asset} onClose={() => setPelnyEkran(false)} />
      )}
      </div>

      <FaktyOKadrze asset={asset} />
    </div>
  );
}
