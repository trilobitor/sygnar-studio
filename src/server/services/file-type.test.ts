import { describe, expect, it } from 'vitest'

import { detectType, isVideo } from './file-type'

/**
 * Typ pliku sprawdzamy po zawartości, nie po rozszerzeniu ani po nagłówku
 * `Content-Type` — obie te rzeczy podaje klient (SPEC §13).
 */

function bytes(...values: number[]): Uint8Array {
  const buffer = new Uint8Array(32)
  buffer.set(values)
  return buffer
}

describe('rozpoznawanie typu po zawartości', () => {
  it('rozpoznaje JPEG', () => {
    expect(detectType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      mime: 'image/jpeg',
      extension: 'jpg',
    })
  })

  it('rozpoznaje PNG', () => {
    expect(detectType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({
      mime: 'image/png',
      extension: 'png',
    })
  })

  it('rozpoznaje MP4 po marce w pudełku ftyp', () => {
    // Cztery bajty rozmiaru, `ftyp`, marka `isom`.
    const mp4 = bytes(
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    )
    expect(detectType(mp4)).toEqual({ mime: 'video/mp4', extension: 'mp4' })
  })

  it('rozpoznaje QuickTime', () => {
    const mov = bytes(
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    )
    expect(detectType(mov)).toEqual({ mime: 'video/quicktime', extension: 'mov' })
  })

  it('odrzuca plik wykonywalny podszywający się rozszerzeniem', () => {
    // Skrypt powłoki nazwany `kadr.png` nie ma sygnatury obrazu.
    const script = new TextEncoder().encode('#!/bin/sh\nrm -rf /\n')
    expect(detectType(script)).toBeNull()
  })

  it('odrzuca pusty plik', () => {
    expect(detectType(new Uint8Array(0))).toBeNull()
  })

  it('odrzuca plik krótszy niż sygnatura', () => {
    expect(detectType(new Uint8Array([0x89, 0x50]))).toBeNull()
  })

  it('odróżnia wideo od obrazu', () => {
    expect(isVideo('video/mp4')).toBe(true)
    expect(isVideo('image/png')).toBe(false)
  })
})
