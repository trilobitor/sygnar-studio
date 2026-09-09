/**
 * Rozpoznawanie typu pliku po zawartości (SPEC §13).
 *
 * Nie po rozszerzeniu i nie po nagłówku `Content-Type` — obie te rzeczy
 * podaje klient, więc obie są danymi, nie faktem. Sprawdzamy bajty.
 */

export type AcceptedMime = 'image/jpeg' | 'image/png' | 'video/mp4' | 'video/quicktime'

export interface DetectedType {
  mime: AcceptedMime
  extension: 'jpg' | 'png' | 'mp4' | 'mov'
}

/** Limit rozmiaru wgrywanego pliku. Wideo bywa ciężkie, ale nie aż tak. */
/**
 * Sufit wagi wgrywanego pliku.
 *
 * Zejście z 512 MB na 100 MB ma dwa powody. Pierwszy: `Request.formData()`
 * buforuje ciało w pamięci wielokrotnie — zmierzone na tej maszynie, plik
 * 50 MB dawał 261 MB przyrostu RSS po samym `formData()` i 311 MB po
 * `arrayBuffer()`, czyli około sześciokrotność. Przy 512 MB jedno wgranie
 * sięgałoby kilku gigabajtów. Drugi: 100 MB w zupełności wystarcza klipowi
 * z telefonu, a to jedyny scenariusz wgrywania wideo w E5.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

/**
 * Marki kontenera ISO-BMFF, które są filmem.
 *
 * Ten sam kontener niesie MP4, MOV, ale też HEIC i AVIF — obrazy. Marka
 * w pudełku `ftyp` jest jedynym, co je odróżnia.
 */
const MARKI_QUICKTIME = new Set(['qt  '])

const MARKI_MP4 = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'avc1', 'M4V ', 'M4A ', 'mmp4', 'dash',
])

/** Cztery znaki marki w pudełku `ftyp` kontenera ISO BMFF. */
function isoBrand(bytes: Uint8Array): string | null {
  // `ftyp` leży na pozycji 4, marka zaraz za nim.
  if (!startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return null
  return String.fromCharCode(...bytes.slice(8, 12))
}

export function detectType(bytes: Uint8Array): DetectedType | null {
  // JPEG: SOI plus znacznik.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', extension: 'jpg' }
  }

  // PNG: ośmiobajtowa sygnatura.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', extension: 'png' }
  }

  const brand = isoBrand(bytes)
  if (brand !== null) {
    if (MARKI_QUICKTIME.has(brand)) {
      return { mime: 'video/quicktime', extension: 'mov' }
    }

    if (MARKI_MP4.has(brand)) {
      return { mime: 'video/mp4', extension: 'mp4' }
    }

    /*
     * Reszta kontenerów ISO-BMFF **nie jest** filmem.
     *
     * Wcześniej wszystko poza QuickTime uchodziło za MP4, więc zdjęcie HEIC
     * z iPhone'a — ten sam kontener, inna marka — wchodziło w tor wideo.
     * Panel oferował dla niego montaż, a ffmpeg kończył błędem po tym, jak
     * grafik zdążył już wybrać kadr i pętlę.
     *
     * Odrzucamy zamiast zgadywać: lista marek jest zamknięta, a nieznana
     * marka to sygnał, że plik jest czymś, czego nie obsługujemy.
     */
    return null
  }

  return null
}

export function isVideo(mime: AcceptedMime): boolean {
  return mime === 'video/mp4' || mime === 'video/quicktime'
}
