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
    if (brand.startsWith('qt')) {
      return { mime: 'video/quicktime', extension: 'mov' }
    }
    // `isom`, `mp42`, `avc1`, `M4V ` i pokrewne traktujemy jako MP4.
    return { mime: 'video/mp4', extension: 'mp4' }
  }

  return null
}

export function isVideo(mime: AcceptedMime): boolean {
  return mime === 'video/mp4' || mime === 'video/quicktime'
}
