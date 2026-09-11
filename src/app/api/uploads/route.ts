import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { uploadFormSchema } from '@/lib/schemas'
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

    /*
     * Nagłówek długości to deklaracja klienta, nie fakt.
     *
     * Żądanie z `Transfer-Encoding: chunked` nie ma `content-length`, więc
     * sprawdzenie wyżej przepuszczało je z `deklarowane` równym zeru, a ciało
     * szło prosto do `formData()` — które buforuje je wielokrotnie, bez
     * żadnego sufitu. Limit 100 MB nadal obowiązywał, ale dopiero po tym, jak
     * pamięć została zajęta (SYG-005).
     *
     * Teraz liczymy bajty w locie i przerywamy w momencie przekroczenia, więc
     * zużycie pamięci jest ograniczone niezależnie od tego, co klient napisał
     * w nagłówkach.
     */
    const strumien = request.body

    if (strumien === null) {
      return fail('VALIDATION_FAILED', 400)
    }

    const kawalki: Uint8Array[] = []
    let policzone = 0
    const czytnik = strumien.getReader()

    for (;;) {
      const { done, value } = await czytnik.read()
      if (done) break

      policzone += value.byteLength

      if (policzone > MAX_UPLOAD_BYTES) {
        await czytnik.cancel()
        logger.warn('odrzucone wgranie po policzeniu bajtów', { bytes: policzone })
        return fail('UPLOAD_TOO_LARGE', 413)
      }

      kawalki.push(value)
    }

    // Odtworzone żądanie niesie te same nagłówki, więc `formData()` widzi
    // granicę części wieloczęściowych tak samo jak przedtem.
    const zmierzone = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: Buffer.concat(kawalki),
    })

    const form = await zmierzone.formData()
    const file = form.get('file')

    if (!(file instanceof File)) {
      return fail('VALIDATION_FAILED', 400)
    }

    // Pola poza plikiem przez schemat, jak każde inne wejście (SPEC §13).
    // Wcześniej sprawdzaliśmy tylko, czy `orderId` jest napisem — dowolny
    // ciąg szedł do bazy i dopiero ona zwracała 404.
    const parsed = uploadFormSchema.safeParse({ orderId: form.get('orderId') })

    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 400)
    }

    const order = getOrder(parsed.data.orderId)

    if (file.size > MAX_UPLOAD_BYTES) {
      return fail('UPLOAD_TOO_LARGE', 413)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectType(bytes)

    if (detected === null) {
      logger.warn('odrzucono wgranie o nierozpoznanym typie', {
        orderId: order.id,
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
      // Szachownica pod podglądem zapala się wyłącznie przy realnym kanale
      // alfa. Sam format nie wystarcza: PNG bywa nieprzezroczysty.
      metadata: metryka !== null && 'hasAlpha' in metryka ? { hasAlpha: metryka.hasAlpha } : undefined,
    })

    touchOrder(order.id, 'active')

    return NextResponse.json({ asset }, { status: 201 })
  } catch (error) {
    return handleError(error, 'POST /api/uploads')
  }
}
