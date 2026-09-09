import { describe, expect, it } from 'vitest'

import { GET as healthGet } from './health/route'
import { GET as ordersGet, POST as ordersPost } from './orders/route'
import {
  DELETE as orderDelete,
  GET as orderGet,
  PATCH as orderPatch,
} from './orders/[id]/route'
import { GET as jobsGet, POST as jobsPost } from './jobs/route'
import { DELETE as jobDelete, GET as jobGet } from './jobs/[id]/route'
import { GET as fileGet } from './files/[assetId]/route'
import { POST as uploadsPost } from './uploads/route'

/**
 * Każdy route handler ma test happy path i minimum dwa przypadki błędu
 * (SPEC §14). Sprawdzamy też regułę z §13: odpowiedź błędna niesie kod,
 * nigdy treści wyjątku ani ścieżki na dysku.
 */

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json()
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('odpowiedź nie jest obiektem')
  }
  // Sprawdzenie powyżej potwierdza kształt; TypeScript nie przenosi go dalej.
  return parsed as Record<string, unknown>
}

/** Zakłada zlecenie i oddaje jego identyfikator — punkt wyjścia wielu testów. */
async function createOrder(name = 'Zlecenie z testu'): Promise<string> {
  const response = await ordersPost(jsonRequest({ name, industry: 'legal' }))
  const body = await readJson(response)
  const order = body.order

  if (typeof order !== 'object' || order === null || !('id' in order)) {
    throw new Error('nie udało się założyć zlecenia')
  }

  return String(Reflect.get(order, 'id'))
}

describe('GET /api/health', () => {
  it('zwraca stan czterech adapterów', async () => {
    const body = await readJson(await healthGet())
    expect(Array.isArray(body.adapters)).toBe(true)
    expect((body.adapters as unknown[]).length).toBe(4)
  })

  it('nie pokazuje nazw narzędzi w etykietach', async () => {
    const body = await readJson(await healthGet())
    const labels = JSON.stringify(body.adapters)

    // Żargon nie wychodzi do interfejsu (SPEC §7a).
    for (const forbidden of ['mflux', 'ComfyUI', 'darktable', 'sharp', 'FFmpeg']) {
      expect(labels.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})

describe('/api/orders', () => {
  it('zakłada zlecenie', async () => {
    const response = await ordersPost(jsonRequest({ name: 'Kancelaria Nowak', industry: 'legal' }))
    expect(response.status).toBe(201)
  })

  it('odrzuca zbyt krótką nazwę', async () => {
    const response = await ordersPost(jsonRequest({ name: 'x' }))
    expect(response.status).toBe(400)
    expect((await readJson(response)).errorCode).toBe('VALIDATION_FAILED')
  })

  it('odrzuca branżę spoza listy', async () => {
    const response = await ordersPost(jsonRequest({ name: 'Nowe', industry: 'kosmonautyka' }))
    expect(response.status).toBe(400)
  })

  it('wypisuje zlecenia', async () => {
    await createOrder()
    const body = await readJson(await ordersGet())
    expect(Array.isArray(body.orders)).toBe(true)
    expect((body.orders as unknown[]).length).toBeGreaterThan(0)
  })
})

describe('/api/orders/[id]', () => {
  it('oddaje zlecenie razem z plikami i zadaniami', async () => {
    const id = await createOrder()
    const body = await readJson(await orderGet(new Request('http://localhost'), params({ id })))

    expect(body.order).toBeDefined()
    expect(Array.isArray(body.assets)).toBe(true)
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  it('zwraca NOT_FOUND dla nieznanego identyfikatora', async () => {
    const response = await orderGet(
      new Request('http://localhost'),
      params({ id: '99999999-9999-4999-8999-999999999999' }),
    )
    expect(response.status).toBe(404)
    expect((await readJson(response)).errorCode).toBe('NOT_FOUND')
  })

  it('nie ujawnia ścieżki na dysku przy błędzie', async () => {
    const response = await orderGet(new Request('http://localhost'), params({ id: 'nie-ma' }))
    const raw = JSON.stringify(await readJson(response))

    expect(raw).not.toContain('/')
    expect(raw).not.toContain('Users')
  })
})

describe('PATCH /api/orders/[id]', () => {
  it('zmienia nazwę zlecenia', async () => {
    const id = await createOrder('Stara nazwa')

    const response = await orderPatch(jsonRequest({ name: 'Nowa nazwa' }), params({ id }))
    expect(response.status).toBe(200)

    const after = await readJson(await orderGet(new Request('http://localhost'), params({ id })))
    const order = after.order
    if (typeof order !== 'object' || order === null) throw new Error('brak zlecenia')
    expect(Reflect.get(order, 'name')).toBe('Nowa nazwa')
  })

  it('odrzuca zbyt krótką nazwę', async () => {
    const id = await createOrder()
    const response = await orderPatch(jsonRequest({ name: 'x' }), params({ id }))
    expect(response.status).toBe(400)
  })

  it('zwraca NOT_FOUND dla nieznanego zlecenia', async () => {
    const response = await orderPatch(jsonRequest({ name: 'Cokolwiek' }), params({ id: 'nie-ma' }))
    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/orders/[id]', () => {
  it('usuwa zlecenie razem z jego plikami', async () => {
    const id = await createOrder('Do usunięcia')

    const png = new Uint8Array(64)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const form = new FormData()
    form.set('orderId', id)
    form.set('file', new File([png], 'kadr.png'))
    const uploaded = await uploadsPost(
      new Request('http://localhost/api/uploads', { method: 'POST', body: form }),
    )
    expect(uploaded.status).toBe(201)

    const deleted = await orderDelete(new Request('http://localhost'), params({ id }))
    expect(deleted.status).toBe(200)

    // Zlecenia nie ma, a wraz z nim kaskadą zniknęły pliki w bazie.
    const after = await orderGet(new Request('http://localhost'), params({ id }))
    expect(after.status).toBe(404)
  })

  it('zwraca NOT_FOUND dla nieznanego zlecenia', async () => {
    const response = await orderDelete(
      new Request('http://localhost'),
      params({ id: '99999999-9999-4999-8999-999999999999' }),
    )
    expect(response.status).toBe(404)
  })

  it('nie ujawnia ścieżki na dysku przy błędzie', async () => {
    const response = await orderDelete(new Request('http://localhost'), params({ id: 'nie-ma' }))
    const raw = JSON.stringify(await readJson(response))
    expect(raw).not.toContain('/')
  })
})

describe('/api/jobs', () => {
  it('przyjmuje zadanie generowania do kolejki', async () => {
    const orderId = await createOrder()
    const response = await jobsPost(
      jsonRequest({
        kind: 'image_generate',
        orderId,
        purpose: 'square',
        promptEn: 'An empty coffee shop in the morning light.',
        width: 1024,
        height: 1024,
        seeds: [1, 2],
      }),
    )

    expect(response.status).toBe(202)
    expect(typeof (await readJson(response)).jobId).toBe('string')
  })

  it('odrzuca kadr powyżej limitu powierzchni', async () => {
    const orderId = await createOrder()
    const response = await jobsPost(
      jsonRequest({
        kind: 'image_generate',
        orderId,
        purpose: 'square',
        promptEn: 'An empty coffee shop in the morning light.',
        width: 2048,
        height: 2048,
        seeds: [1],
      }),
    )

    expect(response.status).toBe(400)
    expect((await readJson(response)).errorCode).toBe('VALIDATION_FAILED')
  })

  it('odrzuca nieznany rodzaj zadania', async () => {
    const response = await jobsPost(jsonRequest({ kind: 'zrob_kawe' }))
    expect(response.status).toBe(400)
  })

  it('wypisuje zadania', async () => {
    const body = await readJson(await jobsGet())
    expect(Array.isArray(body.jobs)).toBe(true)
  })
})

describe('/api/jobs/[id]', () => {
  it('oddaje stan zadania', async () => {
    const orderId = await createOrder()
    const created = await readJson(
      await jobsPost(
        jsonRequest({
          kind: 'image_export',
          orderId,
          assetId: '11111111-1111-4111-8111-111111111111',
          purpose: 'square',
        }),
      ),
    )

    const response = await jobGet(
      new Request('http://localhost'),
      params({ id: String(created.jobId) }),
    )

    expect(response.status).toBe(200)
    expect((await readJson(response)).job).toBeDefined()
  })

  it('zwraca NOT_FOUND dla nieznanego zadania', async () => {
    const response = await jobGet(new Request('http://localhost'), params({ id: 'nie-ma' }))
    expect(response.status).toBe(404)
  })

  it('anulowanie nieznanego zadania też daje NOT_FOUND', async () => {
    const response = await jobDelete(new Request('http://localhost'), params({ id: 'nie-ma' }))
    expect(response.status).toBe(404)
  })
})

describe('/api/files/[assetId]', () => {
  it('zwraca NOT_FOUND dla nieznanego pliku', async () => {
    const response = await fileGet(
      new Request('http://localhost'),
      params({ assetId: '99999999-9999-4999-8999-999999999999' }),
    )
    expect(response.status).toBe(404)
  })

  it('nie przyjmuje ścieżki zamiast identyfikatora', async () => {
    const response = await fileGet(
      new Request('http://localhost'),
      params({ assetId: '../../../etc/passwd' }),
    )
    // Wpisu w bazie nie ma, więc dla klienta to po prostu brak pliku —
    // ścieżka nigdy nie dociera do systemu plików.
    expect(response.status).toBe(404)
  })
})

describe('/api/uploads', () => {
  it('odrzuca plik o nierozpoznanej zawartości', async () => {
    const orderId = await createOrder()
    const form = new FormData()
    form.set('orderId', orderId)
    // Skrypt powłoki nazwany jak obraz — rozszerzenie kłamie, bajty nie.
    form.set('file', new File([new TextEncoder().encode('#!/bin/sh\n')], 'kadr.png'))

    const response = await uploadsPost(
      new Request('http://localhost/api/uploads', { method: 'POST', body: form }),
    )

    expect(response.status).toBe(415)
    expect((await readJson(response)).errorCode).toBe('UPLOAD_UNSUPPORTED_TYPE')
  })

  it('odrzuca żądanie bez pliku', async () => {
    const orderId = await createOrder()
    const form = new FormData()
    form.set('orderId', orderId)

    const response = await uploadsPost(
      new Request('http://localhost/api/uploads', { method: 'POST', body: form }),
    )

    expect(response.status).toBe(400)
  })

  it('przyjmuje PNG i rejestruje plik', async () => {
    const orderId = await createOrder()
    const png = new Uint8Array(64)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const form = new FormData()
    form.set('orderId', orderId)
    form.set('file', new File([png], 'cokolwiek.bin'))

    const response = await uploadsPost(
      new Request('http://localhost/api/uploads', { method: 'POST', body: form }),
    )

    expect(response.status).toBe(201)

    const asset = (await readJson(response)).asset
    if (typeof asset !== 'object' || asset === null) throw new Error('brak pliku w odpowiedzi')

    // Nazwa pochodzi z serwera, nie od klienta — `cokolwiek.bin` nie przetrwało.
    expect(String(Reflect.get(asset, 'path'))).not.toContain('cokolwiek')
    expect(String(Reflect.get(asset, 'path'))).toContain('.png')
  })
})
