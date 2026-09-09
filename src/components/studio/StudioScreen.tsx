'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import {
  Button,
  Dialog,
  EmptyState,
  Field,
  RowMenu,
  Select,
  TextInput,
} from '@/components/ui/primitives'
import { INDUSTRY_LABELS, messageForCode, STAGES } from '@/lib/messages'
import { MAX_UPLOAD_BYTES } from '@/server/services/file-type'
import type { Asset, ErrorResponse, Order, OrderDetail } from '@/types/api'
import { BriefDialog } from './BriefDialog'
import { ContextPanel } from './ContextPanel'
import { Deliverables } from './Deliverables'
import { Gallery, Preview } from './Gallery'
import { JobHistory } from './JobHistory'
import { Lightbox } from './Lightbox'
import { HealthBanner } from './HealthBanner'
import { Wordmark } from './Wordmark'
import { QueueBar } from './QueueBar'
import { SessionBar } from './SessionBar'
import { useQueue } from './use-queue'

/**
 * Ekran roboczy (SPEC §10): trzy kolumny, bez zakładek najwyższego poziomu,
 * pasek kolejki na dole.
 *
 * Aplikacja nie chwali wyniku. Może potwierdzić, że zadanie się udało,
 * i tyle — obrazu nie widzi.
 */

const INDUSTRY_OPTIONS = Object.entries(INDUSTRY_LABELS).map(([value, label]) => ({
  value,
  label,
}))

/**
 * Flaga układu z `localStorage`.
 *
 * Odczyt jest w try/catch, bo dostęp do magazynu potrafi rzucić w oknie
 * prywatnym i przy zablokowanych danych stron — a brak zapamiętanego układu
 * nie może wywrócić panelu.
 */
function wczytajFlage(klucz: string): boolean {
  try {
    return globalThis.localStorage?.getItem(klucz) === '1'
  } catch {
    return false
  }
}

function zapiszFlage(klucz: string, wartosc: boolean): void {
  try {
    globalThis.localStorage?.setItem(klucz, wartosc ? '1' : '0')
  } catch {
    // Brak magazynu nie jest awarią — układ po prostu nie przetrwa odświeżenia.
  }
}

export function StudioScreen({
  initialOrderId,
  autoLogoutSeconds,
  kto,
}: {
  initialOrderId: string | null
  /** Zero wyłącza pasek sesji — panel bez logowania nie ma czego odliczać. */
  autoLogoutSeconds: number
  /** Imię zalogowanej osoby. `null`, gdy panel chodzi bez logowania. */
  kto: string | null
}) {
  /*
   * `null` znaczy „serwer jeszcze nie odpowiedział", pusta tablica — „nie ma
   * żadnego zlecenia". Wcześniej stan startował z pustej tablicy, więc przy
   * pierwszym renderze, zanim `fetch` w ogóle wystartował, grafik czytał
   * „Nie ma jeszcze żadnego zlecenia" — komunikat, którego serwer nie
   * potwierdził i który po chwili sam się podmieniał.
   */
  /*
   * Układ kolumn i tryb galerii. Zapamiętywane w `localStorage`, bo to
   * ustawienie stanowiska, nie stan zlecenia — grafik ustawia je raz i nie
   * chce powtarzać przy każdym wejściu.
   *
   * Odczyt idzie przez leniwy inicjator `useState`, żeby nie wykonał się przy
   * renderze po stronie serwera, gdzie `localStorage` nie istnieje.
   */
  const [lewaZwinieta, setLewaZwinieta] = useState(false)
  const [prawaZwinieta, setPrawaZwinieta] = useState(false)
  const [galeriaSiatka, setGaleriaSiatka] = useState(false)
  const [pomocOtwarta, setPomocOtwarta] = useState(false)
  /** Czy nad kolumną środkową wisi przeciągany plik. */
  const [przeciaganie, setPrzeciaganie] = useState(false)
  /**
   * Kadry zestawione do porównania. `null` znaczy „nie porównujemy".
   *
   * Wybór między czterema podejściami do tej samej sceny polegał na
   * przełączaniu się między nimi i pamiętaniu, jak wyglądał poprzedni —
   * a przy różnicach, o które w tej pracy chodzi (kierunek światła,
   * temperatura barwowa, ułożenie tematu), pamięć wzrokowa nie wystarcza.
   */
  const [porownanie, setPorownanie] = useState<Asset[] | null>(null)

  /*
   * Zapamiętany układ wczytujemy **po** zamontowaniu, nie w inicjatorze stanu.
   * Serwer renderuje układ domyślny, bo `localStorage` po jego stronie nie
   * istnieje; odczyt w inicjatorze dawał inny pierwszy render w przeglądarce
   * i React zgłaszał niezgodność hydratacji (błąd 418). Kosztem jest jedna
   * dodatkowa ramka z układem domyślnym.
   */
  useEffect(() => {
    setLewaZwinieta(wczytajFlage('studio:lewa-zwinieta'))
    setPrawaZwinieta(wczytajFlage('studio:prawa-zwinieta'))
    setGaleriaSiatka(wczytajFlage('studio:galeria-siatka'))
  }, [])

  const [orders, setOrders] = useState<Order[] | null>(null)
  const [orderId, setOrderId] = useState<string | null>(initialOrderId)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [ready, setReady] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /**
   * `null` = nie wgrywamy. Liczba = trwa wysyłka.
   *
   * Wcześniej nic nie blokowało przycisku, więc podwójne kliknięcie
   * wysyłało ten sam plik dwa razy i zakładało dwa wiersze w bazie.
   */
  const [wgrywanie, setWgrywanie] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newIndustry, setNewIndustry] = useState('legal')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [toDelete, setToDelete] = useState<Order | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { jobs, connected } = useQueue()
  const fileInput = useRef<HTMLInputElement>(null)

  // Licznik wymuszający ponowne pobranie. Podbicie go jest jedynym sposobem,
  // w jaki reszta ekranu prosi o odświeżenie danych.
  const [refresh, setRefresh] = useState(0)
  const reload = useCallback(() => setRefresh((value) => value + 1), [])

  // Stabilne funkcje zamykania — inline'owa strzałka zmieniałaby tożsamość
  // propa przy każdej ramce SSE i restartowała efekty w oknie modalnym.
  const zamknijBrief = useCallback(() => setBriefOpen(false), [])
  const zamknijUsuwanie = useCallback(() => setToDelete(null), [])

  // Gdy zadanie się kończy, pliki mogły dojść — to też powód do odświeżenia.
  const doneCount = jobs.filter((job) => job.status === 'done').length

  useEffect(() => {
    let cancelled = false

    async function fetchOrders(): Promise<void> {
      const response = await fetch('/api/orders')
      if (cancelled || !response.ok) return
      const data = (await response.json()) as { orders: Order[] }
      if (cancelled) return
      setOrders(data.orders)
    }

    void fetchOrders()
    return () => {
      cancelled = true
    }
  }, [refresh])

  useEffect(() => {
    if (orderId === null) return

    let cancelled = false

    async function fetchDetail(id: string): Promise<void> {
      const response = await fetch(`/api/orders/${id}`)
      if (cancelled || !response.ok) return
      const data = (await response.json()) as OrderDetail
      if (cancelled) return
      setDetail(data)
    }

    void fetchDetail(orderId)
    return () => {
      cancelled = true
    }
  }, [orderId, refresh, doneCount])

  async function createOrder(): Promise<void> {
    if (newName.trim().length < 2) return
    setCreating(true)

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), industry: newIndustry }),
      })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        setProblem(messageForCode(error.errorCode))
        return
      }

      const data = (await response.json()) as { order: Order }
      setNewName('')
      reload()
      setOrderId(data.order.id)
    } finally {
      setCreating(false)
    }
  }

  async function saveRename(id: string): Promise<void> {
    const name = renameValue.trim()

    if (name.length < 2) {
      setRenamingId(null)
      return
    }

    const response = await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (!response.ok) {
      const error = (await response.json()) as ErrorResponse
      setProblem(messageForCode(error.errorCode))
      return
    }

    setRenamingId(null)
    reload()
  }

  async function confirmDelete(): Promise<void> {
    if (toDelete === null) return
    setDeleting(true)

    try {
      const response = await fetch(`/api/orders/${toDelete.id}`, { method: 'DELETE' })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        setProblem(messageForCode(error.errorCode))
        return
      }

      // Usunięte zlecenie nie może zostać otwarte w środkowej kolumnie.
      if (orderId === toDelete.id) {
        setOrderId(null)
        setDetail(null)
        setSelected(null)
      }

      setToDelete(null)
      reload()
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Wysyłka jednego pliku z prawdziwym postępem.
   *
   * `fetch` nie raportuje postępu wysyłki, więc idziemy przez `XMLHttpRequest`
   * — jedyne API przeglądarki, które daje `upload.onprogress`. Przy klipie
   * ważącym sto megabajtów przez sieć prywatną „Wgrywam…" bez liczby nie mówi,
   * czy cokolwiek się dzieje, czy wysyłka stoi.
   */
  function wyslijPlik(file: File, orderId: string, postep: (ulamek: number) => void): Promise<void> {
    return new Promise((zrobione, blad) => {
      const form = new FormData()
      form.set('orderId', orderId)
      form.set('file', file)

      const zadanie = new XMLHttpRequest()
      zadanie.open('POST', '/api/uploads')

      zadanie.upload.onprogress = (event) => {
        if (event.lengthComputable) postep(event.loaded / event.total)
      }

      zadanie.onload = () => {
        if (zadanie.status >= 200 && zadanie.status < 300) {
          zrobione()
          return
        }

        try {
          const odpowiedz = JSON.parse(zadanie.responseText) as ErrorResponse
          blad(new Error(messageForCode(odpowiedz.errorCode)))
        } catch {
          blad(new Error('Nie udało się wgrać pliku.'))
        }
      }

      zadanie.onerror = () => {
        blad(new Error('Nie udało się wgrać pliku. Sprawdź połączenie i spróbuj jeszcze raz.'))
      }

      zadanie.send(form)
    })
  }

  /**
   * Wgranie jednego pliku albo całej garści.
   *
   * Wcześniej szedł wyłącznie jeden plik naraz, wybierany z okna systemowego,
   * bez przeciągania i bez śladu postępu. Wgranie dziesięciu zdjęć do obróbki
   * wsadowej znaczyło dziesięć przejść przez okno wyboru.
   */
  async function upload(files: File[]): Promise<void> {
    if (orderId === null || wgrywanie !== null || files.length === 0) return
    setProblem(null)

    // Sprawdzenie po stronie klienta, zanim ruszy wysyłka. Serwer i tak
    // odrzuci po `Content-Length`, ale grafik dowiadywałby się o tym dopiero
    // po przesłaniu stu megabajtów przez łącze.
    const zaCiezki = files.find((plik) => plik.size > MAX_UPLOAD_BYTES)

    if (zaCiezki !== undefined) {
      setProblem(messageForCode('UPLOAD_TOO_LARGE'))
      return
    }

    setWgrywanie(0)

    try {
      for (const [numer, plik] of files.entries()) {
        await wyslijPlik(plik, orderId, (ulamek) => {
          // Postęp liczony przez całą paczkę, nie przez pojedynczy plik.
          setWgrywanie((numer + ulamek) / files.length)
        })
      }

      reload()
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : 'Nie udało się wgrać pliku. Sprawdź połączenie i spróbuj jeszcze raz.',
      )
    } finally {
      setWgrywanie(null)
    }
  }

  /**
   * Etap wyprowadzony ze stanu danych, nie z samej liczby plików.
   *
   * Wcześniej pasek zatrzymywał się na „Wybór", bo wyżej nie było jak zajść:
   * warunek patrzył wyłącznie na to, czy w zleceniu są jakiekolwiek pliki.
   * Grafik po eksporcie widział pasek w tym samym miejscu co przed nim.
   */
  /*
   * Skróty klawiszowe (SPEC §10 nic o nich nie mówi, ale narzędzie do
   * przeglądania setek kadrów obsługiwane wyłącznie myszą zmusza do celowania
   * kursorem w kafelek po kafelku).
   *
   * Nasłuch milknie, gdy focus siedzi w polu tekstowym albo gdy otwarte jest
   * okno modalne — inaczej „n" wpisywane w opis zakładałoby nowy brief.
   */
  useEffect(() => {
    function klawisz(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const cel = event.target
      if (
        cel instanceof HTMLElement &&
        (cel.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cel.tagName))
      ) {
        return
      }

      if (briefOpen) return

      const kadry = (detail?.assets ?? []).filter(
        (asset) => asset.kind === 'generated' || asset.kind === 'uploaded',
      )
      const teraz = kadry.findIndex((asset) => asset.id === selected?.id)

      const przesun = (o: number): void => {
        if (kadry.length === 0) return
        const nastepny = kadry[Math.min(Math.max(teraz + o, 0), kadry.length - 1)]
        if (nastepny !== undefined) setSelected(nastepny)
      }

      switch (event.key) {
        case 'ArrowRight':
        case 'j':
        case 'J':
          event.preventDefault()
          przesun(teraz === -1 ? 0 : 1)
          break
        case 'ArrowLeft':
        case 'k':
        case 'K':
          event.preventDefault()
          przesun(teraz === -1 ? 0 : -1)
          break
        case 'n':
        case 'N':
          if (orderId !== null && ready) {
            event.preventDefault()
            setBriefOpen(true)
          }
          break
        case 'g':
        case 'G':
          event.preventDefault()
          setGaleriaSiatka((biezaca) => {
            zapiszFlage('studio:galeria-siatka', !biezaca)
            return !biezaca
          })
          break
        case '[':
          event.preventDefault()
          setLewaZwinieta((biezaca) => {
            zapiszFlage('studio:lewa-zwinieta', !biezaca)
            return !biezaca
          })
          break
        case ']':
          event.preventDefault()
          setPrawaZwinieta((biezaca) => {
            zapiszFlage('studio:prawa-zwinieta', !biezaca)
            return !biezaca
          })
          break
        case 'c':
        case 'C': {
          event.preventDefault()

          // Do porównania idą kadry odłożone gwiazdką; gdy nie ma ich co
          // najmniej dwóch, bierzemy zaznaczony i sąsiednie.
          const odlozone = kadry.filter((asset) => asset.starred === 1).slice(0, 4)
          const wybrane =
            odlozone.length >= 2
              ? odlozone
              : kadry.slice(Math.max(teraz, 0), Math.max(teraz, 0) + 4)

          if (wybrane.length >= 2) setPorownanie(wybrane)
          break
        }
        case ' ': {
          // Spacja odkłada zaznaczony kadr — jak w Lightroomie.
          if (selected === null) break
          event.preventDefault()

          void fetch(`/api/assets/${selected.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ starred: selected.starred !== 1 }),
          })
            .then(() => {
              reload()
            })
            .catch(() => {
              setProblem('Nie udało się odłożyć kadru.')
            })
          break
        }
        case '?':
          event.preventDefault()
          setPomocOtwarta(true)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', klawisz)
    return () => window.removeEventListener('keydown', klawisz)
  }, [briefOpen, detail, orderId, ready, reload, selected])

  /**
   * Generowanie w biegu dla otwartego zlecenia — do kafelków-widm w galerii.
   *
   * Adapter liczy warianty po kolei i uczciwie melduje „Rysuję kadr 2 z 4",
   * ale serwis rejestruje zasoby dopiero po zakończeniu całego przebiegu.
   * Cztery warianty po ~70 s to blisko pięć minut, przez które środkowa
   * kolumna pokazywała pustą galerię z zachętą „Kliknij Nowy brief", a jedynym
   * śladem życia był pasek na dole ekranu. Potem cztery kadry pojawiały się naraz.
   */
  const wTrakcie = ((): { ile: number; postep: number; faza: string | null } | null => {
    const zadanie = jobs.find(
      (job) =>
        job.orderId === orderId &&
        job.kind === 'image_generate' &&
        (job.status === 'queued' || job.status === 'running'),
    )

    if (zadanie === undefined) return null

    // Ile kadrów powstanie — z parametrów zadania, nie z domysłu.
    let ile = 1

    try {
      const parsed: unknown = JSON.parse(zadanie.paramsJson)

      if (typeof parsed === 'object' && parsed !== null) {
        const seeds = Reflect.get(parsed, 'seeds')
        const variants = Reflect.get(parsed, 'variants')

        if (Array.isArray(seeds)) ile = seeds.length
        else if (typeof variants === 'number') ile = variants
      }
    } catch {
      // Nieczytelne parametry nie mogą wywrócić galerii — zostaje jeden widm.
    }

    return { ile, postep: zadanie.progress, faza: zadanie.phase }
  })()

  const stageIndex = ((): number => {
    if (detail === null) return 0
    if (detail.assets.some((a) => a.kind === 'export' || a.kind === 'poster')) return 4
    if (selected !== null) return 3
    if (detail.assets.length > 0) return 2
    if (detail.brief !== null) return 1
    return 0
  })()

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      {/*
        Przejście do treści — pierwszy element w kolejności tabulacji, niewidoczny
        dopóki nie dostanie focusu. Bez niego osoba pracująca z klawiaturą
        przechodzi przez całą listę zleceń, zanim dotrze do galerii.
      */}
      <a
        href="#tresc"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-surface-0"
      >
        Przejdź do kadrów
      </a>
      <HealthBanner onReadyChange={setReady} />

      <div className="flex min-h-0 flex-1">
        {/* Obszary strony bez nazw brzmią w czytniku ekranu identycznie —
            „uzupełniające", „uzupełniające", „główne". Nazwy pozwalają
            przeskakiwać między nimi zamiast czytać wszystko po kolei. */}
        <aside
          aria-label="Zlecenia"
          className={`flex shrink-0 flex-col gap-3 border-r border-line bg-surface-1 transition-all ${lewaZwinieta ? 'w-10 items-center p-1' : 'w-64 p-3'}`}
        >
          {/*
            Zwijanie kolumny — klawisz [ albo ten przycisk. Podgląd kadru jest
            najcenniejszą przestrzenią na ekranie 1366 px i dostawał jej najmniej;
            zwinięcie obu kolumn oddaje mu sto trzydzieści sześć pikseli.
          */}
          <button
            type="button"
            onClick={() =>
              setLewaZwinieta((biezaca) => {
                zapiszFlage('studio:lewa-zwinieta', !biezaca)
                return !biezaca
              })
            }
            aria-expanded={!lewaZwinieta}
            aria-label={`${lewaZwinieta ? 'Rozwiń' : 'Zwiń'} listę zleceń`}
            title={`${lewaZwinieta ? 'Rozwiń' : 'Zwiń'} — klawisz [`}
            className="self-end flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-base text-ink-muted transition hover:border-field hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {lewaZwinieta ? '»' : '«'}
          </button>

          {/* Zwinięta kolumna to sam pasek — treść znika, zamiast wylewać się
              poza czterdzieści pikseli. */}
          {!lewaZwinieta && (
            <>
          {/* Znak marki jest nagłówkiem pierwszego poziomu — lista zleceń
              schodzi o poziom niżej, żeby nagłówki szły bez przeskoków. */}
          <h1 className="sr-only">Sygnar Studio</h1>
          <Wordmark />

          <h2 className="text-sm font-medium tracking-wide text-ink">Zlecenia</h2>

          <div className="flex flex-col gap-2 rounded border border-line p-2">
            <Field label="Nowe zlecenie">
              {(id) => (
                <TextInput
                  id={id}
                  value={newName}
                  onChange={setNewName}
                  maxLength={120}
                  placeholder="Kancelaria Nowak"
                />
              )}
            </Field>
            <Field label="Branża">
              {(id) => (
                <Select
                  id={id}
                  value={newIndustry}
                  onChange={setNewIndustry}
                  options={INDUSTRY_OPTIONS}
                />
              )}
            </Field>
            <Button
              variant="primary"
              disabled={creating || newName.trim().length < 2}
              onClick={() => void createOrder()}
            >
              {creating ? 'Zakładam…' : 'Załóż zlecenie'}
            </Button>
          </div>

          <nav aria-label="Lista zleceń" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {orders === null ? (
              // Szkielet, nie komunikat: układ nie skacze, a grafik nie czyta
              // zdania, które za chwilę samo zniknie.
              <div aria-hidden="true" className="flex flex-col gap-1">
                <span className="h-8 animate-pulse rounded bg-surface-2" />
                <span className="h-8 animate-pulse rounded bg-surface-2" />
                <span className="h-8 animate-pulse rounded bg-surface-2" />
              </div>
            ) : orders.length === 0 ? (
              <EmptyState>
                Nie ma jeszcze żadnego zlecenia. Załóż pierwsze powyżej — wszystko inne dzieje
                się w jego wnętrzu.
              </EmptyState>
            ) : (
              orders.map((order) =>
                renamingId === order.id ? (
                  <input
                    key={order.id}
                    type="text"
                    /*
                     * Focus idzie tu w odpowiedzi na świadomą akcję albo na stronie, która ma
                     * dokładnie jedno pole. Niczego nie przesłania i nikomu nie odbiera kontekstu.
                     */
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={renameValue}
                    maxLength={120}
                    aria-label={`Nowa nazwa zlecenia ${order.name}`}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => void saveRename(order.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveRename(order.id)
                      if (event.key === 'Escape') setRenamingId(null)
                    }}
                    className="rounded border border-accent bg-surface-2 px-2 py-1.5 text-sm text-ink"
                  />
                ) : (
                  <div
                    key={order.id}
                    className={`flex items-center rounded transition ${
                      orderId === order.id ? 'bg-surface-2' : 'hover:bg-surface-2'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOrderId(order.id)
                        setSelected(null)
                      }}
                      aria-current={orderId === order.id}
                      // Nazwa jest ucinana wielokropkiem, więc bez tego dymka
                      // dłuższe nazwy zleceń stawały się nie do odróżnienia.
                      title={order.name}
                      className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm ${
                        orderId === order.id ? 'text-ink' : 'text-ink-muted'
                      }`}
                    >
                      {order.name}
                      {order.industry !== null && (
                        <span className="ml-1 text-xs text-ink-muted">
                          · {INDUSTRY_LABELS[order.industry] ?? order.industry}
                        </span>
                      )}
                    </button>

                    <RowMenu
                      label={`Więcej opcji dla zlecenia ${order.name}`}
                      items={[
                        {
                          label: 'Zmień nazwę',
                          onSelect: () => {
                            setRenameValue(order.name)
                            setRenamingId(order.id)
                          },
                        },
                        {
                          label: 'Odłóż do archiwum',
                          onSelect: () => {
                            void fetch(`/api/orders/${order.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: order.name,
                                industry: order.industry ?? undefined,
                                status: 'archived',
                              }),
                            })
                              .then(() => {
                                if (orderId === order.id) setOrderId(null)
                                reload()
                              })
                              .catch(() => {
                                setProblem('Nie udało się odłożyć zlecenia do archiwum.')
                              })
                          },
                        },
                        {
                          label: 'Usuń zlecenie',
                          danger: true,
                          onSelect: () => setToDelete(order),
                        },
                      ]}
                    />
                  </div>
                ),
              )
            )}
          </nav>
            </>
          )}
        </aside>

        {/*
          Przeciąganie plików na kolumnę środkową. Wcześniej jedyną drogą było
          okno wyboru plików, po jednym pliku — wgranie dziesięciu zdjęć do
          obróbki wsadowej znaczyło dziesięć przejść przez to okno.

          `onDragOver` musi wołać `preventDefault`, inaczej przeglądarka otworzy
          upuszczony plik zamiast oddać go stronie.
        */}
        <main
          id="tresc"
          className={`relative flex min-w-0 flex-1 flex-col gap-3 p-4 ${
            przeciaganie ? 'outline-2 outline-dashed outline-offset-[-8px] outline-ink-muted' : ''
          }`}
          onDragOver={(event) => {
            if (orderId === null) return
            event.preventDefault()
            setPrzeciaganie(true)
          }}
          onDragLeave={(event) => {
            // Zdarzenie leci też przy przejściu nad dzieckiem — reagujemy
            // tylko wtedy, gdy kursor naprawdę opuścił kolumnę.
            const cel = event.relatedTarget

            if (!(cel instanceof Node) || !event.currentTarget.contains(cel)) {
              setPrzeciaganie(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            setPrzeciaganie(false)
            void upload([...event.dataTransfer.files])
          }}
        >
          {przeciaganie && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 z-20 text-center text-sm text-ink">
              Upuść pliki, żeby je wgrać
            </p>
          )}
          <h2 className="sr-only">Kadry wybranego zlecenia</h2>
          {/* Etapy po lewej, sesja po prawej — jeden wiersz, żeby nie zabierać
              pionowego miejsca podglądowi kadru. */}
          <div className="flex items-center justify-between gap-4">
            <ol className="flex items-center gap-2 text-sm text-ink-muted" aria-label="Etapy pracy">
              {STAGES.map((stage, index) => (
                <li
                  key={stage}
                  /*
                    Trzy stany, nie dwa. Wcześniej etap przebyty i bieżący
                    dostawały dokładnie ten sam kolor, a jedyną różnicą był
                    `aria-current` — niewidoczny okiem. Rozróżniamy je w skali
                    szarości, bez akcentu: pasek stoi bezpośrednio nad kadrem,
                    a nasycony kolor w tym miejscu psuje ocenę barw (SPEC §10).
                  */
                  className={`flex h-8 items-center ${
                    index === stageIndex
                      ? 'font-medium text-ink underline decoration-ink-muted underline-offset-4'
                      : index < stageIndex
                        ? 'text-ink'
                        : 'text-ink-muted'
                  }`}
                  aria-current={index === stageIndex ? 'step' : undefined}
                >
                  {index < stageIndex && (
                    <span aria-hidden="true" className="mr-1 text-ink-muted">
                      ✓
                    </span>
                  )}
                  {stage}
                  {index < STAGES.length - 1 && (
                    <span aria-hidden="true" className="ml-2 text-ink-muted">
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>

            {autoLogoutSeconds > 0 && <SessionBar timeoutSeconds={autoLogoutSeconds} kto={kto} />}
          </div>

          {/* Historia zadań — zwinięta, bo to rzecz, do której się zagląda. */}
          {detail !== null && detail.order.id === orderId && (
            <JobHistory jobs={detail.jobs} onChanged={reload} />
          )}

          {problem !== null && (
            <p role="alert" className="rounded border border-danger bg-danger/10 px-3 py-2 text-sm">
              {problem}
            </p>
          )}

          {orderId === null ? (
            <EmptyState>
              Wybierz zlecenie z listy po lewej albo załóż nowe. Brief, kadry i eksporty
              trzymają się zlecenia.
            </EmptyState>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  disabled={!ready}
                  onClick={() => setBriefOpen(true)}
                  title={ready ? undefined : 'Stacja jest offline'}
                >
                  Nowy brief
                </Button>
                <Button
                  disabled={wgrywanie !== null}
                  onClick={() => fileInput.current?.click()}
                >
                  {wgrywanie !== null
                    ? `Wgrywam… ${String(Math.round(wgrywanie * 100))}%`
                    : 'Wgraj własne pliki'}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,video/mp4,video/quicktime"
                  className="hidden"
                  aria-label="Wybierz pliki do wgrania"
                  onChange={(event) => {
                    void upload([...(event.target.files ?? [])])
                    event.target.value = ''
                  }}
                />
              </div>

              <Preview asset={selected} />

              {/* Pasek miniatur albo pełna siatka — przełącznik pod klawiszem G.
                  Blok zablokowany na 256 px zabierał podgładowi wysokość, której
                  ten i tak miał najmniej. */}
              <div className={`flex min-h-0 flex-col ${galeriaSiatka ? 'max-h-[55vh]' : 'max-h-72'}`}>
                <Gallery
                  assets={detail?.assets ?? []}
                  laduje={detail === null || detail.order.id !== orderId}
                  wTrakcie={wTrakcie}
                  siatka={galeriaSiatka}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  onChanged={reload}
                />
              </div>
            </>
          )}
        </main>

        <aside
          aria-label="Eksport i pliki do oddania"
          className={`flex shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-surface-1 transition-all ${prawaZwinieta ? 'w-10 items-center p-1' : 'w-72 p-3'}`}
        >
          {/*
            Zwijanie kolumny — klawisz ] albo ten przycisk. Podgląd kadru jest
            najcenniejszą przestrzenią na ekranie 1366 px i dostawał jej najmniej;
            zwinięcie obu kolumn oddaje mu sto trzydzieści sześć pikseli.
          */}
          <button
            type="button"
            onClick={() =>
              setPrawaZwinieta((biezaca) => {
                zapiszFlage('studio:prawa-zwinieta', !biezaca)
                return !biezaca
              })
            }
            aria-expanded={!prawaZwinieta}
            aria-label={`${prawaZwinieta ? 'Rozwiń' : 'Zwiń'} panel eksportu`}
            title={`${prawaZwinieta ? 'Rozwiń' : 'Zwiń'} — klawisz ]`}
            className="self-start flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-base text-ink-muted transition hover:border-field hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {prawaZwinieta ? '«' : '»'}
          </button>

          {/* Zwinięta kolumna to sam pasek — treść znika, zamiast wylewać się
              poza czterdzieści pikseli. */}
          {!prawaZwinieta && (
            <>
          {orderId === null ? (
            <EmptyState>Najpierw wybierz zlecenie.</EmptyState>
          ) : (
            <>
              <ContextPanel
                // Remount przy zmianie zaznaczenia. Bez tego zakres przycięcia
                // i wpisany opis poprawki zostawały po poprzednim pliku.
                key={selected?.id ?? 'brak'}
                orderId={orderId}
                asset={selected}
                disabled={!ready}
                onQueued={reload}
              />
              <Deliverables assets={detail?.assets ?? []} orderId={orderId} />
            </>
          )}
            </>
          )}
        </aside>
      </div>

      <QueueBar
        jobs={jobs}
        connected={connected}
        onChanged={reload}
      />

      <Dialog
        open={toDelete !== null}
        title="Usunąć zlecenie?"
        onClose={zamknijUsuwanie}
        footer={
          <>
            <Button onClick={zamknijUsuwanie}>Zostaw</Button>
            <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? 'Usuwam…' : 'Usuń bezpowrotnie'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Zlecenie <strong>{toDelete?.name}</strong> zniknie razem ze wszystkimi kadrami,
          wgranymi plikami i eksportami. Tego nie da się cofnąć.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Jeśli chcesz je tylko schować z listy, powiedz — dorobimy archiwizowanie zamiast
          kasowania.
        </p>
      </Dialog>

      {porownanie !== null && (
        <Lightbox assets={porownanie} onClose={() => setPorownanie(null)} />
      )}

      <Dialog
        open={pomocOtwarta}
        onClose={() => setPomocOtwarta(false)}
        title="Skróty klawiszowe"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[
            ['← → albo J K', 'poprzedni i następny kadr'],
            ['F', 'podgląd na cały ekran'],
            ['Z', 'skala podglądu: wpasuj, 100 %, 200 %'],
            ['G', 'pasek miniatur albo pełna siatka'],
            ['N', 'nowy brief'],
            ['[ i ]', 'zwiń lewą i prawą kolumnę'],
            ['C', 'porównaj odłożone kadry obok siebie'],
            ['Spacja', 'odłóż zaznaczony kadr na bok'],
            ['?', 'to okno'],
            ['Escape', 'zamknij okno albo podgląd'],
          ].map(([klawisz, opis]) => (
            <Fragment key={klawisz}>
              <dt className="font-mono text-ink">{klawisz}</dt>
              <dd className="text-ink-muted">{opis}</dd>
            </Fragment>
          ))}
        </dl>
      </Dialog>

      {orderId !== null && detail?.order.id === orderId && (
        <BriefDialog
          // Remount przy zmianie zlecenia — bez tego wypełniony brief jednego
          // zlecenia pokazywał się w oknie następnego.
          //
          // Warunek `detail?.order.id === orderId` jest równie istotny: wartości
          // startowe pól czyta `useState`, czyli **raz, przy montowaniu**. Okno
          // zamontowane przed dojściem danych zapisywało pustki i zapisany brief
          // nigdy nie wracał, mimo że API go zwracało.
          key={orderId}
          open={briefOpen}
          orderId={orderId}
          brief={detail.brief}
          disabled={!ready}
          onClose={zamknijBrief}
          onQueued={reload}
        />
      )}
    </div>
  )
}
