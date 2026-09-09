import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { probeVideo } from '@/server/adapters/ffmpeg'
import { readDimensions } from '@/server/adapters/sharp'
import { fail, handleError, tooMany } from '@/server/api/respond'
import { clientKey, consume, UPLOAD_LIMIT } from '@/server/services/rate-limit'
import { ensureStarted } from '@/server/bootstrap'
import { wymagajSesji } from '@/server/api/sesja'
import { registerAsset } from '@/server/services/assets'
import { detectType, isVideo, MAX_UPLOAD_BYTES } from '@/server/services/file-type'
import { getOrder, touchOrder } from '@/server/services/orders'
import { bucketDir } from '@/server/services/paths'

export const dynamic = 'force-dynamic'

/**
 * Wgranie pliku do zlecenia (SPEC §8).
 *
 * Typ sprawdzany po zawartości, nie po rozszerzeniu ani po `Content-Type`.
 * Nazwa pliku generowana przez serwer, nigdy przyjmowana od klienta —
 * nazwa od użytkownika w ścieżce to zapis w dowolne miejsce na dysku.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    ensureStarted()

    // `/api/uploads` jest wyłączone spod `proxy.ts`, bo Next buforuje ciało dla
    // warstwy pośredniczącej i ucina je na 10 MB. Sesję sprawdzamy więc tutaj.
    wymagajSesji(request)

    const decision = consume(clientKey(request, 'wgrywanie'), UPLOAD_LIMIT)
    if (!decision.allowed) return tooMany(decision.retryAfterSeconds)

    // Odrzucamy po nagłówku, **zanim** dotkniemy ciała. `Request.formData()`
    // buforuje je w pamięci wielokrotnie, więc sprawdzanie `file.size` po
    // sparsowaniu jest już po szkodzie — zmierzone: plik 50 MB to 261 MB RSS.
    const deklarowane = Number(request.headers.get('content-length') ?? '0')

    if (Number.isFinite(deklarowane) && deklarowane > MAX_UPLOAD_BYTES) {
      logger.warn('odrzucone wgranie po nagłówku długości', { bytes: deklarowane })
      return fail('UPLOAD_TOO_LARGE', 413)
    }

    const form = await request.formData()
    const orderId = form.get('orderId')
    const file = form.get('file')

    if (typeof orderId !== 'string' || !(file instanceof File)) {
      return fail('VALIDATION_FAILED', 400)
    }

    const order = getOrder(orderId)

    if (file.size > MAX_UPLOAD_BYTES) {
      return fail('UPLOAD_TOO_LARGE', 413)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectType(bytes)

    if (detected === null) {
      logger.warn('odrzucono wgranie o nierozpoznanym typie', {
        orderId,
        // Rozmiar i deklarowany typ zostają w logu; treści pliku nie logujemy.
        declared: file.type,
        bytes: file.size,
      })
      return fail('UPLOAD_UNSUPPORTED_TYPE', 415)
    }

    // Nazwa w całości od serwera: identyfikator plus rozszerzenie z sygnatury.
    const fileName = `${randomUUID()}.${detected.extension}`
    const absolutePath = join(bucketDir(env.STUDIO_DATA_DIR, order.id, 'uploads'), fileName)

    await writeFile(absolutePath, bytes)

    // Film sondujemy ffprobe'em, obraz sharpem. Przy filmie liczy się także
    // długość — bez niej panel montażu nie ma z czego zbudować zakresu
    // przycięcia i operacja `trim` zostaje niedostępna z poziomu UI.
    const metryka = isVideo(detected.mime)
      ? await probeVideo(absolutePath)
      : { ...(await readDimensions(absolutePath)), durationMs: null }

    const asset = await registerAsset({
      orderId: order.id,
      jobId: null,
      kind: 'uploaded',
      absolutePath,
      mime: detected.mime,
      width: metryka?.width ?? undefined,
      height: metryka?.height ?? undefined,
      durationMs: metryka?.durationMs ?? undefined,
    })

    touchOrder(order.id, 'active')

    return NextResponse.json({ asset }, { status: 201 })
  } catch (error) {
    return handleError(error, 'POST /api/uploads')
  }
}
