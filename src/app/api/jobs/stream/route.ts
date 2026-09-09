import { logger } from '@/lib/logger'
import { ensureStarted } from '@/server/bootstrap'
import { listJobs } from '@/server/queue/store'
import { subscribe } from '@/server/queue/events'

export const dynamic = 'force-dynamic'

/**
 * SSE ze stanem kolejki (SPEC §8).
 *
 * Jedno połączenie na klienta, stan całej kolejki. Odpytywanie co sekundę
 * przy zadaniach trwających minuty to marnowanie zasobów po obu stronach.
 */
export async function GET(request: Request): Promise<Response> {
  ensureStarted()

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const send = (payload: unknown): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          // Klient zniknął w trakcie zapisu — sprzątamy i nie hałasujemy.
          closed = true
        }
      }

      // Pierwsza ramka od razu, żeby interfejs nie czekał na zmianę stanu.
      send({ jobs: listJobs(20), at: Date.now() })

      const unsubscribe = subscribe((snapshot) => {
        send(snapshot)
      })

      // Komentarz co 20 sekund utrzymuje połączenie przy życiu przez proxy
      // — Tailscale i przeglądarka potrafią uciąć milczący strumień.
      const keepAlive = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': tik\n\n'))
        } catch {
          closed = true
        }
      }, 20_000)

      const close = (): void => {
        if (closed) return
        closed = true
        clearInterval(keepAlive)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Strumień mógł już zostać zamknięty przez zerwane połączenie.
        }
        logger.debug('zamknięto strumień kolejki')
      }

      request.signal.addEventListener('abort', close, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Bez tego pośrednik potrafi buforować cały strumień do końca zadania.
      'X-Accel-Buffering': 'no',
    },
  })
}
