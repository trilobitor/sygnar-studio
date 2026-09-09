"use client";

import { useEffect, useState } from "react";

import { Button, Dialog, EmptyState, Field, Hint, TextArea } from "@/components/ui/primitives";
import { FIELD_HINTS, messageForCode } from "@/lib/messages";
import { OUTPUT_PRESETS } from "@/lib/output-presets";
import type { Asset, ErrorResponse } from "@/types/api";

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

/**
 * Czy pod obrazem ma stać szachownica.
 *
 * Wyłącznie przy realnym kanale alfa, zapisanym przy rejestrowaniu pliku.
 * Rozpoznawanie po formacie nie działa: generator zapisuje PNG bez
 * przezroczystości, więc krata wychodziłaby wokół każdego kadru.
 */
function maPrzezroczystosc(asset: Asset): boolean {
  if (asset.metadataJson === null) return false;

  try {
    const parsed: unknown = JSON.parse(asset.metadataJson);
    if (typeof parsed !== "object" || parsed === null) return false;

    return Reflect.get(parsed, "hasAlpha") === true;
  } catch {
    return false;
  }
}

/** Klucz miejsca docelowego z metadanych kadru. `null`, gdy kadr go nie niesie. */
function odczytajPurpose(asset: Asset): string | null {
  if (asset.metadataJson === null) return null;

  try {
    const parsed: unknown = JSON.parse(asset.metadataJson);
    if (typeof parsed !== "object" || parsed === null) return null;

    const purpose = Reflect.get(parsed, "purpose");
    return typeof purpose === "string" ? purpose : null;
  } catch {
    return null;
  }
}

export function Gallery({
  assets,
  selectedId,
  onSelect,
  onChanged,
  laduje,
  wTrakcie,
  siatka,
}: {
  assets: Asset[];
  selectedId: string | null;
  onSelect: (asset: Asset) => void;
  /** Wołane po odłożeniu kadru na bok — lista musi się przeładować. */
  onChanged: () => void;
  /** `true`, dopóki szczegół zlecenia nie wrócił z serwera. */
  laduje: boolean;
  /** Generowanie w biegu dla tego zlecenia — `null`, gdy stacja jest wolna. */
  wTrakcie: { ile: number; postep: number; faza: string | null } | null;
  /**
   * `true` — pełna siatka pod klawiszem G, gęsta, do przeglądania setek kadrów.
   * `false` — pasek czterech miniatur ze szkicu w SPEC §10, z większymi
   * kafelkami, bo to jest widok roboczy przy wyborze wariantu.
   */
  siatka: boolean;
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

  /**
   * Filtr po rodzaju pliku i po miejscu docelowym.
   *
   * Galeria była jedną płaską siatką wszystkich kadrów, doładowywaną po
   * dwadzieścia cztery — jedyną drogą do kadru sprzed trzech dni było klikanie
   * „Pokaż kolejne". Dane były pod ręką od początku: rodzaj siedzi w kolumnie
   * `kind`, a miejsce docelowe w metadanych. Wszystko liczy się po stronie
   * przeglądarki, na już pobranej liście — bez nowego endpointu.
   */
  const [rodzaj, setRodzaj] = useState<"wszystkie" | "generated" | "uploaded" | "oddanie">(
    "wszystkie",
  );
  const [gdzie, setGdzie] = useState<string>("wszystkie");

  async function przelaczOdlozenie(asset: Asset): Promise<void> {
    await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: asset.starred !== 1 }),
    }).catch(() => {});

    onChanged();
  }

  const doOddania = (asset: Asset): boolean =>
    asset.kind === "export" || asset.kind === "poster";

  const images = assets
    .filter((asset) =>
      rodzaj === "wszystkie"
        ? asset.kind === "generated" || asset.kind === "uploaded"
        : rodzaj === "oddanie"
          ? doOddania(asset)
          : asset.kind === rodzaj,
    )
    .filter((asset) => gdzie === "wszystkie" || odczytajPurpose(asset) === gdzie)
    .filter((asset) => !tylkoOdlozone || asset.starred === 1);

  // Miejsca docelowe, które w tym zleceniu faktycznie występują — filtr nie
  // proponuje wartości, po której nic się nie znajdzie.
  const dostepneMiejsca = [
    ...new Set(assets.map(odczytajPurpose).filter((klucz): klucz is string => klucz !== null)),
  ];

  if (laduje) {
    /*
      Szkielet, dopóki serwer nie odpowie. Wcześniej galeria z miejsca pisała
      „Nie ma tu jeszcze żadnego kadru" — komunikat, którego nikt nie
      potwierdził, wyświetlany zanim zapytanie w ogóle wystartowało.
    */
    return (
      <div className="grid grid-cols-4 items-start gap-3">
        {[0, 1, 2, 3].map((nr) => (
          <span key={nr} className="aspect-4/3 animate-pulse rounded bg-surface-2" />
        ))}
      </div>
    );
  }

  if (images.length === 0 && wTrakcie === null) {
    return (
      <EmptyState>
        Nie ma tu jeszcze żadnego kadru. Kliknij <strong>Nowy brief</strong>,
        opisz, co ma być na obrazie, i policzymy kilka podejść.
      </EmptyState>
    );
  }

  const shown = images.slice(0, visible);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Objaśnienie numeru losowania stoi raz nad siatką, nie przy każdym
          kadrze — kafelek jest przyciskiem, a przycisk w przycisku nie działa. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Rodzaj pliku jako rząd przycisków — najczęstszy podział, więc stoi
            pierwszy i nie wymaga rozwijania listy. */}
        <div className="flex gap-1" role="group" aria-label="Rodzaj plików">
          {(
            [
              ["wszystkie", "Wszystko"],
              ["generated", "Kadry"],
              ["uploaded", "Wgrane"],
              ["oddanie", "Do oddania"],
            ] as const
          ).map(([klucz, etykieta]) => (
            <button
              key={klucz}
              type="button"
              aria-pressed={rodzaj === klucz}
              onClick={() => setRodzaj(klucz)}
              className={`rounded border px-2 py-0.5 text-xs transition ${
                rodzaj === klucz
                  ? "border-field bg-surface-2 text-ink"
                  : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {etykieta}
            </button>
          ))}
        </div>
      
        <div className="flex items-center gap-3">
          {dostepneMiejsca.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              Miejsce
              <select
                value={gdzie}
                onChange={(event) => setGdzie(event.target.value)}
                className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink"
              >
                <option value="wszystkie">wszystkie</option>
                {dostepneMiejsca.map((klucz) => (
                  <option key={klucz} value={klucz}>
                    {OUTPUT_PRESETS[klucz as keyof typeof OUTPUT_PRESETS]?.label ?? klucz}
                  </option>
                ))}
              </select>
            </label>
          )}
      
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={tylkoOdlozone}
              onChange={(event) => setTylkoOdlozone(event.target.checked)}
            />
            Tylko odłożone
          </label>
        </div>
      </div>
      
      <p className="flex items-baseline text-xs text-ink-muted">
        Pod każdym kadrem jest numer losowania
        <Hint text={FIELD_HINTS.seed} />
      </p>

      {/*
        Przewija się wyłącznie siatka. Wcześniej cały blok miał wspólne
        przewijanie, więc rząd filtrów odjeżdżał razem z kafelkami i znikał
        z oczu dokładnie wtedy, gdy był potrzebny.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {/*
        Kolumny dobierają się do szerokości zamiast sztywnych czterech. Szkic
        w SPEC §10 pokazuje pasek czterech miniatur; przy zwiniętych kolumnach
        bocznych mieści się ich więcej, przy wąskim oknie mniej. Odstępstwo
        zapisane w dzienniku jako D71.
      */}
      <div
        className={`grid items-start gap-3 ${siatka ? "" : "grid-cols-4"}`}
        style={{
          gridTemplateColumns: siatka ? "repeat(auto-fill, minmax(180px, 1fr))" : undefined,
        }}
      >
        {/*
          Kafelki-widma: tyle, ile kadrów powstaje, z paskiem postępu w środku.
          Przez pięć minut liczenia galeria stała pusta, a jedynym śladem życia
          był pasek na dole ekranu — potem wszystkie kadry pojawiały się naraz.
        */}
        {wTrakcie !== null &&
          Array.from({ length: wTrakcie.ile }, (_, nr) => (
            <div
              key={`widmo-${String(nr)}`}
              data-widmo=""
              aria-hidden="true"
              className="flex aspect-4/3 flex-col items-center justify-center gap-2 rounded border border-dashed border-line bg-surface-1 p-2 text-center"
            >
              <span className="h-1 w-3/4 overflow-hidden rounded bg-surface-2">
                <span
                  className="block h-full bg-ink-muted transition-all"
                  style={{ width: `${String(Math.round(wTrakcie.postep * 100))}%` }}
                />
              </span>
              <span className="text-xs text-ink-muted">{wTrakcie.faza ?? "Liczę…"}</span>
            </div>
          ))}

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
              /*
                Gwiazdka jest widoczna zawsze, przygaszona do połowy.
                Wcześniej miała `opacity-0` i wyjeżdżała na `group-hover` —
                a klasa `group` siedzi na sąsiednim przycisku kafelka, nie na
                wspólnym przodku, więc ten warunek nie zapalał się nigdy.
                Gwiazdki nie dało się zobaczyć ani myszą, ani palcem; jedyną
                drogą było przejście tabulatorem, które zapalało `focus`.
                Funkcja istniała w bazie, w serwisie i w interfejsie — i nie
                było jak jej użyć.
              */
              className={`absolute right-1 top-1 z-10 rounded px-1.5 py-0.5 text-sm transition ${
                asset.starred === 1
                  ? "bg-surface-0/80 text-accent opacity-100"
                  : "bg-surface-0/60 text-ink-muted opacity-50 hover:text-accent hover:opacity-100 focus:opacity-100"
              }`}
            >
              {asset.starred === 1 ? "★" : "☆"}
            </button>

            <button
              type="button"
              onClick={() => onSelect(asset)}
              // Dwuklik na kadrze odkłada go na bok — ta sama akcja co
              // gwiazdka, bez celowania w róg kafelka.
              onDoubleClick={() => void przelaczOdlozenie(asset)}
              title="Dwuklik odkłada kadr na bok"
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
                /*
                  Proporcje z rzeczywistych wymiarów kadru, nie sztywne 4:3.
                  Presety idą od 3:4 (usługa pionowa, 1200 × 1600) po 16:9
                  (plansza wideo, 1920 × 1088). W kafelku 4:3 z `object-cover`
                  kadr pionowy tracił kilkanaście procent góry i dołu, poziomy
                  boki — czyli dokładnie te obszary, które brief nazywa martwymi
                  strefami. Różna wysokość kafelków jest zaletą: od razu widać,
                  który kadr jest pionowy.
                */
                style={{ aspectRatio: `${String(asset.width)} / ${String(asset.height)}` }}
                className={maPrzezroczystosc(asset) ? "checkerboard" : "bg-surface-0"}
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
                    className="h-full w-full object-contain"
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
                      className="h-full w-full object-contain"
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
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-0.5 text-xs text-ink-muted">
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

export function Preview({
  asset,
  orderId,
  onChanged,
}: {
  asset: Asset | null;
  orderId: string | null;
  /** Wołane po zleceniu poprawki — kolejka i galeria muszą się odświeżyć. */
  onChanged: () => void;
}) {
  const [pelnyEkran, setPelnyEkran] = useState(false);
  const [poprawkaOtwarta, setPoprawkaOtwarta] = useState(false);
  const [instrukcja, setInstrukcja] = useState("");
  const [wysylam, setWysylam] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Zlecenie poprawki kadru.
   *
   * To nie to samo co „ten sam numer, nowy opis" z panelu eksportu: tam kadr
   * powstaje od zera i wychodzi inny, choćby zmiana była drobna. Tutaj model
   * dostaje gotowy kadr i zdanie mówiące, co ma być inaczej — reszta zostaje.
   */
  async function zlecPoprawke(): Promise<void> {
    if (asset === null || orderId === null) return;

    setWysylam(true);
    setProblem(null);

    try {
      const odpowiedz = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image_edit",
          orderId,
          assetId: asset.id,
          instructionEn: instrukcja.trim(),
        }),
      });

      if (!odpowiedz.ok) {
        const blad = (await odpowiedz.json()) as ErrorResponse;
        setProblem(messageForCode(blad.errorCode));
        return;
      }

      setPoprawkaOtwarta(false);
      setInstrukcja("");
      onChanged();
    } catch {
      setProblem("Nie udało się zlecić poprawki. Sprawdź połączenie.");
    } finally {
      setWysylam(false);
    }
  }

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
    <div className="group/podglad relative flex flex-1 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-0">
      {/*
        Pobranie oglądanego pliku.
        Kadru ani wgranego pliku nie dało się pobrać wcale — służyły wyłącznie
        do oglądania. Grafik, który chciał wysłać klientowi surowy kadr do
        akceptacji, robił zrzut ekranu albo szukał pliku na dysku.
      */}
      {/* Narzędzia podglądu: pojawiają się po najechaniu, żeby nie leżały
          na kadrze przez cały czas. Na dotyku `group-hover` nie zadziała,
          więc obie ikony są tam widoczne od razu (`opacity-100` bez wskaźnika). */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-100 transition group-hover/podglad:opacity-100 md:opacity-0">
        {!isVideo && (
          <>
            <button
              type="button"
              onClick={() => setPoprawkaOtwarta(true)}
              aria-label="Popraw ten kadr"
              title="Popraw fragment kadru — model zostawi resztę bez zmian"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface-0/85 text-sm text-ink-muted transition hover:border-field hover:text-ink"
            >
              🖌
            </button>

            <button
              type="button"
              onClick={() => setPelnyEkran(true)}
              aria-label="Powiększ na cały ekran"
              title="Powiększ na cały ekran — klawisz F"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface-0/85 text-sm text-ink-muted transition hover:border-field hover:text-ink"
            >
              ⤢
            </button>
          </>
        )}

        <a
          href={`/api/files/${asset.id}?pobierz`}
          download
          title="Pobierz ten plik"
          className="flex h-9 items-center rounded-md border border-line bg-surface-0/85 px-3 text-xs text-ink-muted transition hover:border-field hover:text-ink"
        >
          Pobierz
        </a>
      </div>

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
            maPrzezroczystosc(asset) ? "checkerboard" : ""
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

      <Dialog
        open={poprawkaOtwarta}
        onClose={() => setPoprawkaOtwarta(false)}
        title="Popraw ten kadr"
        footer={
          <>
            <Button onClick={() => setPoprawkaOtwarta(false)}>Anuluj</Button>
            <Button
              variant="primary"
              disabled={wysylam || instrukcja.trim().length < 3}
              onClick={() => void zlecPoprawke()}
            >
              {wysylam ? "Zlecam…" : "Popraw"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Model dostanie ten kadr i Twoje zdanie. Zmieni to, o co poprosisz, a resztę
            zostawi — kompozycję, światło i wszystko, czego nie wymienisz.
          </p>
      
          <Field
            label="Co ma być inaczej"
            hint="Po angielsku, jedno zdanie. Na przykład: change the wall colour to deep navy, keep everything else identical."
            counter={`${instrukcja.length}/600`}
          >
            {(id) => (
              <TextArea
                id={id}
                value={instrukcja}
                onChange={setInstrukcja}
                rows={4}
                maxLength={600}
                lang="en"
                placeholder="change the wall colour to deep navy, keep everything else identical"
              />
            )}
          </Field>
      
          {problem !== null && (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
      
          <p className="text-xs text-ink-muted">
            Poprawka zajmuje stację na mniej więcej dwie minuty. Powstanie nowy kadr —
            pierwowzór zostaje.
          </p>
        </div>
      </Dialog>
      
      {pelnyEkran && !isVideo && (
        <Lightbox assets={[asset]} onClose={() => setPelnyEkran(false)} />
      )}
      </div>

      <FaktyOKadrze asset={asset} />
    </div>
  );
}
