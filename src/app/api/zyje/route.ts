import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Czy proces odpowiada. Nic więcej.
 *
 * `wdrozenie/README.md` kazał sprawdzać wdrożenie przez `/api/health`, ale ten
 * endpoint stoi za bramką logowania i zwracał 401 — czyli komenda z instrukcji
 * nie mówiła nic o stacji, tylko o tym, że curl nie ma ciasteczka.
 *
 * Nie otwieramy `/api/health`, bo zdradza dokładne wersje ffmpeg, mfluxa
 * i sharpa oraz wolne miejsce na dysku. Przy panelu wystawionym Funnelem to
 * gotowa podpowiedź dla kogoś szukającego znanych dziur w konkretnej wersji.
 *
 * Ta odpowiedź jest stała i nie mówi niczego, czego nie widać po samym tym,
 * że serwer w ogóle odpisał.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true })
}
