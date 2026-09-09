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
import type { Asset, ErrorResponse, Order, OrderDetail } from '@/types/api'
import { BriefDialog } from './BriefDialog'
import { ContextPanel } from './ContextPanel'
import { Gallery, Preview } from './Gallery'
import { HealthBanner } from './HealthBanner'
import { QueueBar } from './QueueBar'
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

export function StudioScreen({ initialOrderId }: { initialOrderId: string | null }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderId, setOrderId] = useState<string | null>(initialOrderId)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [ready, setReady] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newIndustry, setNewIndustry] = useState('legal')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [toDelete, setToDelete] = useState<Order | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { jobs } = useQueue()
  const fileInput = useRef<HTMLInputElement>(null)

  // Licznik wymuszający ponowne pobranie. Podbicie go jest jedynym sposobem,
  // w jaki reszta ekranu prosi o odświeżenie danych.
  const [refresh, setRefresh] = useState(0)
  const reload = useCallback(() => setRefresh((value) => value + 1), [])

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
    if (orderId === null) return
    setProblem(null)

    const form = new FormData()
    form.set('orderId', orderId)
    form.set('file', file)

    const response = await fetch('/api/uploads', { method: 'POST', body: form })

    if (!response.ok) {
      const error = (await response.json()) as ErrorResponse
      setProblem(messageForCode(error.errorCode))
      return
    }

    reload()
  }

  const stageIndex = detail === null ? 0 : detail.assets.length > 0 ? 2 : 1

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      <HealthBanner onReadyChange={setReady} />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-line bg-surface-1 p-3">
          <h1 className="text-sm font-medium tracking-wide text-ink">Zlecenia</h1>

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

          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {orders.length === 0 ? (
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

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <ol className="flex gap-2 text-xs text-ink-muted" aria-label="Etapy pracy">
            {STAGES.map((stage, index) => (
              <li
                key={stage}
                className={index <= stageIndex ? 'text-accent' : undefined}
                aria-current={index === stageIndex}
              >
                {stage}
                {index < STAGES.length - 1 && <span className="ml-2 text-line">→</span>}
              </li>
            ))}
          </ol>

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
                <Button onClick={() => fileInput.current?.click()}>Wgraj własny plik</Button>
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
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                />
              </div>
            </>
          )}
        </main>

        <aside className="w-72 shrink-0 border-l border-line bg-surface-1 p-3">
          {orderId === null ? (
            <EmptyState>Najpierw wybierz zlecenie.</EmptyState>
          ) : (
            <ContextPanel
              orderId={orderId}
              asset={selected}
              disabled={!ready}
              onQueued={reload}
            />
          )}
        </aside>
      </div>

      <QueueBar
        jobs={jobs}
        onChanged={reload}
      />

      <Dialog
        open={toDelete !== null}
        title="Usunąć zlecenie?"
        onClose={() => setToDelete(null)}
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Zostaw</Button>
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

      {orderId !== null && (
        <BriefDialog
          open={briefOpen}
          orderId={orderId}
          disabled={!ready}
          onClose={() => setBriefOpen(false)}
          onQueued={reload}
        />
      )}
    </div>
  )
}
