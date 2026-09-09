'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
import { HealthBanner } from './HealthBanner'
import { Wordmark } from './Wordmark'
import { QueueBar } from './QueueBar'
import { OrderSummary } from '@/components/studio/OrderSummary'
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

  async function upload(file: File): Promise<void> {
    if (orderId === null || wgrywanie !== null) return
    setProblem(null)

    // Sprawdzenie po stronie klienta, zanim ruszy wysyłka. Serwer i tak
    // odrzuci po `Content-Length`, ale grafik dowiadywałby się o tym dopiero
    // po przesłaniu stu megabajtów przez łącze.
    if (file.size > MAX_UPLOAD_BYTES) {
      setProblem(messageForCode('UPLOAD_TOO_LARGE'))
      return
    }

    const form = new FormData()
    form.set('orderId', orderId)
    form.set('file', file)

    setWgrywanie(0)

    try {
      const response = await fetch('/api/uploads', { method: 'POST', body: form })

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse
        setProblem(messageForCode(error.errorCode))
        return
      }

      reload()
    } catch {
      setProblem('Nie udało się wgrać pliku. Sprawdź połączenie i spróbuj jeszcze raz.')
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
          className="flex w-64 shrink-0 flex-col gap-3 border-r border-line bg-surface-1 p-3"
        >
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
        </aside>

        <main id="tresc" className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <h2 className="sr-only">Kadry wybranego zlecenia</h2>
          {/* Etapy po lewej, sesja po prawej — jeden wiersz, żeby nie zabierać
              pionowego miejsca podglądowi kadru. */}
          <div className="flex items-center justify-between gap-4">
            <ol className="flex gap-2 text-xs text-ink-muted" aria-label="Etapy pracy">
              {STAGES.map((stage, index) => (
                <li
                  key={stage}
                  /* Skala szarości, nie akcent: pasek stoi bezpośrednio nad
                     kadrem, a nasycony kolor w tym miejscu psuje ocenę barw. */
                  className={index <= stageIndex ? 'font-medium text-ink' : undefined}
                  aria-current={index === stageIndex}
                >
                  {stage}
                  {index < STAGES.length - 1 && <span className="ml-2 text-line">→</span>}
                </li>
              ))}
            </ol>

            {autoLogoutSeconds > 0 && <SessionBar timeoutSeconds={autoLogoutSeconds} kto={kto} />}
          </div>

          {/* Liczby do wyceny — zwinięte, liczone dopiero po rozwinięciu. */}
          {orderId !== null && <OrderSummary key={orderId} orderId={orderId} />}

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
                  {wgrywanie !== null ? 'Wgrywam…' : 'Wgraj własny plik'}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,video/mp4,video/quicktime"
                  className="hidden"
                  aria-label="Wybierz plik do wgrania"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file !== undefined) void upload(file)
                    event.target.value = ''
                  }}
                />
              </div>

              <Preview asset={selected} />

              <div className="max-h-64 overflow-y-auto">
                <Gallery
                  assets={detail?.assets ?? []}
                  laduje={detail === null || detail.order.id !== orderId}
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
          className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface-1 p-3"
        >
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
              <Deliverables assets={detail?.assets ?? []} />
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
