import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Pięć scenariuszy z `SPEC.md` §14. Lista jest zamknięta — nowy scenariusz
 * wymaga wpisu w specyfikacji, nie dopisania pliku.
 *
 * Testy uderzają w prawdziwą stację. Scenariusze 1–3 uruchamiają zadania GPU
 * i trwają minuty; scenariusze 4–5 są szybkie.
 */

const SQUARE = { width: 1024, height: 1024 }

async function createOrder(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/orders', {
    data: { name, industry: 'legal' },
  })
  expect(response.status()).toBe(201)
  const body = (await response.json()) as { order: { id: string } }
  return body.order.id
}

async function waitForJob(
  request: APIRequestContext,
  jobId: string,
  timeoutMs = 240_000,
): Promise<{ status: string; errorCode: string | null }> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const response = await request.get(`/api/jobs/${jobId}`)
    const body = (await response.json()) as {
      job: { status: string; errorCode: string | null }
    }

    if (['done', 'failed', 'cancelled'].includes(body.job.status)) {
      return body.job
    }

    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  throw new Error('zadanie nie skończyło się w wyznaczonym czasie')
}

test.describe('Sygnar Studio', () => {
  test('1. nowe zlecenie → brief → generowanie → warianty w galerii', async ({
    page,
    request,
  }) => {
    const orderId = await createOrder(request, 'E2E — cztery warianty')

    const enqueued = await request.post('/api/jobs', {
      data: {
        kind: 'image_generate',
        orderId,
        purpose: 'square',
        promptEn: 'An empty coffee shop early in the morning, warm window light, wooden tables.',
        ...SQUARE,
        seeds: [11, 22, 33, 44],
      },
    })
    expect(enqueued.status()).toBe(202)

    const { jobId } = (await enqueued.json()) as { jobId: string }
    const job = await waitForJob(request, jobId)
    expect(job.status).toBe('done')

    const detail = await request.get(`/api/orders/${orderId}`)
    const body = (await detail.json()) as { assets: { kind: string; seed: number | null }[] }
    const generated = body.assets.filter((asset) => asset.kind === 'generated')

    expect(generated).toHaveLength(4)
    // Numer losowania jest przy każdym kadrze — bez niego nie da się
    // poprosić o poprawkę tego samego ujęcia.
    expect(generated.every((asset) => asset.seed !== null)).toBe(true)

    /*
     * Zakaz żargonu (SPEC §7a) sprawdzany dopiero tutaj, na ekranie
     * z wypełnioną galerią. Wcześniej stał w scenariuszu 5, na stronie
     * głównej bez wybranego zlecenia — czyli bez galerii, briefu i paska
     * montażu, a więc bez wszystkich miejsc, w których te słowa mogłyby
     * wyciec. Tamten test przechodził niezależnie od implementacji.
     */
    await page.goto(`/n/obrazy/${orderId}`)
    await expect(page.getByRole('img').first()).toBeVisible()

    const widoczny = (await page.locator('body').innerText()).toLowerCase()

    for (const zakazane of ['comfyui', 'mflux', 'guidance', 'workflow', 'vae', 'seed']) {
      expect(widoczny, `żargon „${zakazane}" wyciekł do interfejsu`).not.toContain(zakazane)
    }
  })

  test('2. wybór wariantu → eksport → plik poniżej limitu wagi', async ({ request }) => {
    const orderId = await createOrder(request, 'E2E — eksport')

    const enqueued = await request.post('/api/jobs', {
      data: {
        kind: 'image_generate',
        orderId,
        purpose: 'square',
        promptEn: 'A quiet reading room with tall windows and warm afternoon light.',
        ...SQUARE,
        seeds: [77],
      },
    })
    const { jobId } = (await enqueued.json()) as { jobId: string }
    expect((await waitForJob(request, jobId)).status).toBe('done')

    const detail = await request.get(`/api/orders/${orderId}`)
    const body = (await detail.json()) as { assets: { id: string; kind: string }[] }
    const source = body.assets.find((asset) => asset.kind === 'generated')
    expect(source).toBeDefined()

    const exportJob = await request.post('/api/jobs', {
      data: { kind: 'image_export', orderId, assetId: source?.id, purpose: 'case' },
    })
    const exported = (await exportJob.json()) as { jobId: string }
    expect((await waitForJob(request, exported.jobId, 120_000)).status).toBe('done')

    const after = await request.get(`/api/orders/${orderId}`)
    const files = (await after.json()) as { assets: { kind: string; bytes: number }[] }
    const exports = files.assets.filter((asset) => asset.kind === 'export')

    expect(exports.length).toBeGreaterThan(0)
    // Limit slotu `case` to 160 KB (brief realizacyjny §4.8).
    expect(exports.every((asset) => asset.bytes <= 160 * 1024)).toBe(true)
  })

  test('3. wgranie klipu → pętla → eksport MP4 i WebM', async ({ request }) => {
    test.skip(
      process.env.E2E_VIDEO_FIXTURE === undefined,
      'Wymaga pliku wideo: ustaw E2E_VIDEO_FIXTURE na ścieżkę do krótkiego MP4.',
    )

    const orderId = await createOrder(request, 'E2E — wideo')
    const fixture = process.env.E2E_VIDEO_FIXTURE ?? ''

    // Playwright traktuje goły string jako **pole tekstowe**, nie plik —
    // dlatego ten scenariusz zwracał 400 i nigdy nie mógł przejść. Plik
    // trzeba podać jako `{ name, mimeType, buffer }`.
    const upload = await request.post('/api/uploads', {
      multipart: {
        orderId,
        file: {
          name: basename(fixture),
          mimeType: 'video/mp4',
          buffer: await readFile(fixture),
        },
      },
    })
    expect(upload.status()).toBe(201)

    const { asset } = (await upload.json()) as { asset: { id: string } }

    const render = await request.post('/api/jobs', {
      data: {
        kind: 'video_render',
        orderId,
        assetId: asset.id,
        targetMb: 2,
        poster: true,
        operations: [
          { kind: 'crop', aspect: 'vertical' },
          { kind: 'loop', pingPong: true },
        ],
      },
    })
    const { jobId } = (await render.json()) as { jobId: string }
    expect((await waitForJob(request, jobId)).status).toBe('done')

    const detail = await request.get(`/api/orders/${orderId}`)
    const body = (await detail.json()) as { assets: { mime: string }[] }
    const mimes = body.assets.map((a) => a.mime)

    expect(mimes).toContain('video/mp4')
    expect(mimes).toContain('video/webm')
    expect(mimes).toContain('image/jpeg')
  })

  test('4. anulowanie zadania w trakcie', async ({ request }) => {
    const orderId = await createOrder(request, 'E2E — anulowanie')

    const enqueued = await request.post('/api/jobs', {
      data: {
        kind: 'image_generate',
        orderId,
        purpose: 'square',
        promptEn: 'A long empty corridor with soft daylight falling from high windows.',
        ...SQUARE,
        seeds: [101, 202, 303, 404, 505, 606, 707, 808],
      },
    })
    const { jobId } = (await enqueued.json()) as { jobId: string }

    // Dajemy zadaniu ruszyć, zanim je przerwiemy.
    await new Promise((resolve) => setTimeout(resolve, 6000))

    const cancelled = await request.delete(`/api/jobs/${jobId}`)
    expect(cancelled.ok()).toBe(true)

    const job = await waitForJob(request, jobId, 60_000)
    expect(job.status).toBe('cancelled')
    expect(job.errorCode).toBe('JOB_CANCELLED')
  })

  test('5. stacja niedostępna → czytelny komunikat, brak zawieszenia', async ({
    page,
  }: {
    page: Page
  }) => {
    // Udajemy, że sprawdzenie stanu mówi „nic nie działa".
    await page.route('**/api/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ready: false,
          adapters: [
            { name: 'generator', label: 'Generowanie obrazów', status: { ok: false, reason: 'missing_binary' } },
          ],
          checkedAt: Date.now(),
        }),
      })
    })

    // `/` to od teraz ekran wyboru narzędzia; ekran roboczy jest pod /n/obrazy.
    await page.goto('/n/obrazy')

    // Komunikat mówi, co zrobić, nie co się zepsuło wewnątrz.
    // Zawężamy do naszego banera — Next.js trzyma własny `role="alert"`
    // na anonser tras i bez tego selektor trafiałby w dwa elementy.
    const banner = page.getByRole('alert').filter({ hasText: 'Stacja' })
    await expect(banner).toContainText('Stacja jest offline. Napisz do Kamila')

    // Formularz nowego zlecenia jest zablokowany, dopóki stacja nie wróci.
    await expect(page.getByRole('button', { name: /nowe zlecenie/i })).toBeDisabled()

    // Strona żyje — nie zawiesiła się na nieudanym sprawdzeniu.
    await expect(page.getByRole('heading', { name: 'Zlecenia' })).toBeVisible()
  })
})
