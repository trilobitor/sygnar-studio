import { beforeEach, describe, expect, it } from 'vitest'

import { resetAll } from '@/server/services/rate-limit'

import { ADAPTER_NAMES } from '@/server/services/health'
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

/*
 * Testy tras dzieliły licznik limitu żądań, więc kolejność ich uruchomienia
 * zmieniała wynik: dwudziesty pierwszy przypadek w pliku dostawał 429 zamiast
 * spodziewanego kodu. Zerujemy licznik przed każdym.
 */
beforeEach(() => {
  resetAll()
})

describe('GET /api/health', () => {
  it('zwraca stan wszystkich sprawdzanych rzeczy', async () => {
    const body = await readJson(await healthGet())
    expect(Array.isArray(body.adapters)).toBe(true)
    expect((body.adapters as unknown[]).length).toBe(ADAPTER_NAMES.length)
  })

  it('pyta o bazę i o dysk, nie tylko o narzędzia', async () => {
    // Bez tych dwóch `/api/health` odpowiadał `ready: true` przy bazie
    // wypełnionej losowymi bajtami, podczas gdy `/api/orders` dawało 500.
    const body = await readJson(await healthGet())
    const nazwy = (body.adapters as { name: string }[]).map((a) => a.name)

    expect(nazwy).toContain('baza')
    expect(nazwy).toContain('dysk')
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
    const body = await readJson(await ordersGet(new Request('http://localhost/api/orders')))
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
    const cialo = await readJson(response)

    // Odpowiedź niesie sam kod błędu — bez ścieżki, bez komunikatu wyjątku.
    expect(Object.keys(cialo)).toEqual(['errorCode'])
    expect(JSON.stringify(cialo)).not.toContain('/')
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
    expect(Object.keys(await readJson(response))).toEqual(['errorCode'])
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

/**
 * Trasy dopisane po audycie (ustalenia #23, #46, #52). Każda z nich robi coś,
 * czego typecheck nie sprawdza: serwuje bajty z dysku, przyjmuje ciało
 * żądania albo zwraca strumień zdarzeń.
 */
describe('/api/zyje', () => {
  it('odpowiada bez zalogowania i nie zdradza niczego o maszynie', async () => {
    const { GET } = await import('./zyje/route')
    const response = GET()
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    // Cała odpowiedź to jedno pole. Wersje narzędzi i wolne miejsce zostają
    // w `/api/health`, który stoi za bramką.
    expect(Object.keys(body)).toEqual(['ok'])
    expect(JSON.stringify(body)).not.toMatch(/\d+\.\d+\.\d+/)
  })
})

describe('/api/files/[assetId] — zakresy bajtów', () => {
  async function przygotujPlik(): Promise<string> {
    const orderId = await createOrder()
    const form = new FormData()
    form.set('orderId', orderId)
    // Najmniejszy poprawny PNG: sygnatura wystarcza `detectType`.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(2048).fill(0x42),
    ])
    form.set('file', new File([png], 'kadr.png', { type: 'image/png' }))

    const response = await uploadsPost(
      new Request('http://localhost/api/uploads', { method: 'POST', body: form }),
    )
    const body = (await readJson(response)) as { asset?: { id: string } }
    const id = body.asset?.id

    // Bez tej asercji nieudane wgranie dawało puste `id`, testy poniżej
    // wychodziły przez `return` i przechodziły **nic nie sprawdzając**.
    // Dokładnie ta pułapka zdarzyła się już raz w tym projekcie.
    expect(id, 'przygotowanie pliku do testu nie powiodło się').toBeTruthy()
    return id ?? ''
  }

  it('bez nagłówka Range oddaje całość i ogłasza obsługę zakresów', async () => {
    const assetId = await przygotujPlik()

    const response = await fileGet(new Request('http://localhost'), params({ assetId }))

    expect(response.status).toBe(200)
    // Bez tego nagłówka przeglądarka wyłącza przewijanie podglądu wideo.
    expect(response.headers.get('accept-ranges')).toBe('bytes')
  })

  it('z nagłówkiem Range oddaje fragment i mówi który', async () => {
    const assetId = await przygotujPlik()

    const response = await fileGet(
      new Request('http://localhost', { headers: { range: 'bytes=0-99' } }),
      params({ assetId }),
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/)
    expect(response.headers.get('content-length')).toBe('100')
  })

  it('zakres poza plikiem to 416, nie pusty sukces', async () => {
    const assetId = await przygotujPlik()

    const response = await fileGet(
      new Request('http://localhost', { headers: { range: 'bytes=999999999-' } }),
      params({ assetId }),
    )

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/)
  })
})

describe('/api/uploads — sufit wagi', () => {
  it('odrzuca po nagłówku długości, zanim dotknie ciała', async () => {
    // Odrzucenie musi nastąpić przed `formData()`, bo ono buforuje ciało
    // wielokrotnie — zmierzone, plik 50 MB to 311 MB RSS.
    const orderId = await createOrder()
    const form = new FormData()
    form.set('orderId', orderId)
    form.set('file', new File([new Uint8Array(16)], 'kadr.png', { type: 'image/png' }))

    const response = await uploadsPost(
      new Request('http://localhost/api/uploads', {
        method: 'POST',
        body: form,
        // Deklarujemy 600 MB, choć ciało jest maleńkie — sprawdzamy właśnie
        // bramkę po nagłówku, nie po rzeczywistym rozmiarze.
        headers: { 'content-length': String(600 * 1024 * 1024) },
      }),
    )

    expect(response.status).toBe(413)
    expect((await readJson(response)).errorCode).toBe('UPLOAD_TOO_LARGE')
  })

  it('odrzuca niepoprawny identyfikator zlecenia schematem', async () => {
    // Handler sprawdzał wyłącznie `typeof orderId !== 'string'`, więc dowolny
    // napis szedł do bazy.
    const form = new FormData()
    form.set('orderId', 'to-nie-jest-uuid')
    form.set('file', new File([new Uint8Array(16)], 'kadr.png', { type: 'image/png' }))

    const response = await uploadsPost(
      new Request('http://localhost/api/uploads', { method: 'POST', body: form }),
    )

    expect(response.status).toBe(400)
  })
})

describe('odpowiedzi błędów nie wynoszą szczegółów', () => {
  it('komunikat wyjątku nie trafia do ciała odpowiedzi', async () => {
    /*
     * Poprzednia wersja tego sprawdzenia asertowała, że ciało nie zawiera
     * ukośnika — a `fail()` buduje ciało wyłącznie z kodu błędu, więc taka
     * asercja nie mogła upaść niezależnie od implementacji.
     *
     * Prawdziwe kryterium: wyjątek niosący ścieżkę na dysku ma nie przeciec
     * do odpowiedzi.
     */
    const { handleError } = await import('@/server/api/respond')
    const odpowiedz = handleError(
      new Error('ENOENT: no such file or directory, open /Users/kamilkmiec/tajne/plik.png'),
      'test',
    )

    const cialo = (await odpowiedz.json()) as Record<string, unknown>

    expect(Object.keys(cialo)).toEqual(['errorCode'])
    expect(JSON.stringify(cialo)).not.toContain('kamilkmiec')
    expect(JSON.stringify(cialo)).not.toContain('ENOENT')
    expect(odpowiedz.status).toBe(500)
  })

  it('to samo dla błędu z kodem systemu plików', async () => {
    const { handleError } = await import('@/server/api/respond')
    const blad = Object.assign(new Error('EACCES: permission denied, /Users/kamilkmiec/Sygnar'), {
      code: 'EACCES',
    })

    const cialo = (await handleError(blad, 'test').json()) as Record<string, unknown>

    expect(JSON.stringify(cialo)).not.toContain('/Users')
  })
})
