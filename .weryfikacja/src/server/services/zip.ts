import { crc32, deflateRawSync } from 'node:zlib'

/**
 * Zapis archiwum ZIP bez nowej zależności.
 *
 * `CLAUDE.md` każe pytać, zanim dojdzie biblioteka, a cały potrzebny format to
 * trzy struktury: nagłówek lokalny przed każdym plikiem, katalog centralny na
 * końcu i rekord zamykający. Node ma `deflateRaw` i `crc32` w standardzie,
 * więc nie brakuje niczego poza złożeniem bajtów w odpowiedniej kolejności.
 *
 * Świadome ograniczenia: bez ZIP64 (limit 4 GB na plik i na całość) i bez
 * strumieniowania — archiwum powstaje w pamięci. Paczka do oddania to kilka
 * plików po kilkaset kilobajtów, więc obie granice są daleko.
 */

export interface WpisArchiwum {
  /** Nazwa w archiwum. Bez katalogów nadrzędnych i bez ukośnika na początku. */
  nazwa: string
  dane: Buffer
}

/** Znacznik czasu w formacie MS-DOS, którego wymaga ZIP. */
function czasDos(data: Date): { czas: number; data: number } {
  return {
    czas:
      (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2),
    data:
      ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  }
}

export function zbudujZip(wpisy: WpisArchiwum[], teraz = new Date()): Buffer {
  const { czas, data } = czasDos(teraz)

  const czesci: Buffer[] = []
  const katalog: Buffer[] = []
  let offset = 0

  for (const wpis of wpisy) {
    const nazwa = Buffer.from(wpis.nazwa, 'utf8')
    const suma = crc32(wpis.dane)
    const spakowane = deflateRawSync(wpis.dane)

    // Metoda 8 to deflate. Flaga 0x800 mówi, że nazwa jest w UTF-8 —
    // bez niej polskie znaki w nazwach plików rozsypią się przy rozpakowaniu.
    const naglowek = Buffer.alloc(30)
    naglowek.writeUInt32LE(0x04034b50, 0)
    naglowek.writeUInt16LE(20, 4)
    naglowek.writeUInt16LE(0x800, 6)
    naglowek.writeUInt16LE(8, 8)
    naglowek.writeUInt16LE(czas, 10)
    naglowek.writeUInt16LE(data, 12)
    naglowek.writeUInt32LE(suma, 14)
    naglowek.writeUInt32LE(spakowane.length, 18)
    naglowek.writeUInt32LE(wpis.dane.length, 22)
    naglowek.writeUInt16LE(nazwa.length, 26)
    naglowek.writeUInt16LE(0, 28)

    czesci.push(naglowek, nazwa, spakowane)

    const wpisKatalogu = Buffer.alloc(46)
    wpisKatalogu.writeUInt32LE(0x02014b50, 0)
    wpisKatalogu.writeUInt16LE(20, 4)
    wpisKatalogu.writeUInt16LE(20, 6)
    wpisKatalogu.writeUInt16LE(0x800, 8)
    wpisKatalogu.writeUInt16LE(8, 10)
    wpisKatalogu.writeUInt16LE(czas, 12)
    wpisKatalogu.writeUInt16LE(data, 14)
    wpisKatalogu.writeUInt32LE(suma, 16)
    wpisKatalogu.writeUInt32LE(spakowane.length, 20)
    wpisKatalogu.writeUInt32LE(wpis.dane.length, 24)
    wpisKatalogu.writeUInt16LE(nazwa.length, 28)
    wpisKatalogu.writeUInt32LE(offset, 42)

    katalog.push(wpisKatalogu, nazwa)
    offset += naglowek.length + nazwa.length + spakowane.length
  }

  const katalogBajty = Buffer.concat(katalog)

  const koniec = Buffer.alloc(22)
  koniec.writeUInt32LE(0x06054b50, 0)
  koniec.writeUInt16LE(wpisy.length, 8)
  koniec.writeUInt16LE(wpisy.length, 10)
  koniec.writeUInt32LE(katalogBajty.length, 12)
  koniec.writeUInt32LE(offset, 16)

  return Buffer.concat([...czesci, katalogBajty, koniec])
}
