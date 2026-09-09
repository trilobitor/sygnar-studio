import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

import { ApiError } from '@/server/adapters/types'

/**
 * Budowanie ścieżek plików (SPEC §13).
 *
 * Klient nigdy nie podaje ścieżki, tylko `assetId`. Serwer składa ścieżkę
 * z katalogu danych i wartości z bazy, po czym weryfikuje, że wynik
 * po normalizacji nadal leży w katalogu danych. Brak tej weryfikacji
 * to odczyt dowolnego pliku z dysku.
 *
 * Funkcje przyjmują katalog danych jako argument, żeby dały się przetestować
 * bez ustawiania zmiennych środowiskowych.
 */

export type AssetBucket = 'generated' | 'uploads' | 'exports'

/** Katalog zlecenia wewnątrz katalogu danych. */
export function orderDir(dataDir: string, orderId: string): string {
  assertSafeSegment(orderId)
  return join(resolve(dataDir), 'orders', orderId)
}

/**
 * Katalog roboczy pojedynczego zadania wewnątrz `generated`.
 *
 * Osobny katalog na zadanie, bo nazwy plików niosą numer losowania, a ten sam
 * numer w tym samym zleceniu jest normalną sytuacją przy powtarzaniu kadru.
 * Wspólny katalog dawałby kolizję, a mflux przy kolizji dokłada `_1` do nazwy
 * i adapter zarejestrowałby stary plik pod nowym numerem.
 */
export function jobWorkDir(dataDir: string, orderId: string, jobId: string): string {
  assertSafeSegment(jobId)
  return join(bucketDir(dataDir, orderId, 'generated'), jobId)
}

/** Katalog na konkretny rodzaj plików w obrębie zlecenia. */
export function bucketDir(dataDir: string, orderId: string, bucket: AssetBucket): string {
  return join(orderDir(dataDir, orderId), bucket)
}

/**
 * Zamienia ścieżkę względną z bazy na bezwzględną i sprawdza, że wynik
 * nie wyszedł poza katalog danych. Rzuca, gdy wyszedł.
 */
export function resolveAssetPath(dataDir: string, relativePath: string): string {
  const root = resolve(dataDir)

  if (isAbsolute(relativePath)) {
    throw new ApiError('PATH_INVALID', 'ścieżka z bazy nie może być bezwzględna', 500)
  }

  const candidate = resolve(root, normalize(relativePath))

  if (!isInside(root, candidate)) {
    throw new ApiError('PATH_INVALID', 'ścieżka wyszła poza katalog danych', 500)
  }

  return candidate
}

/** Ścieżka względna zapisywana w bazie. Zawsze z ukośnikami w jedną stronę. */
export function toRelativePath(dataDir: string, absolutePath: string): string {
  const root = resolve(dataDir)
  const candidate = resolve(absolutePath)

  if (!isInside(root, candidate)) {
    throw new ApiError('PATH_INVALID', 'ścieżka leży poza katalogiem danych', 500)
  }

  return relative(root, candidate).split(sep).join('/')
}

/**
 * Czy `candidate` leży wewnątrz `root`. Porównanie po `relative`, nie przez
 * `startsWith` na stringu — `/dane-inne` zaczyna się od `/dane`, a nie leży w nim.
 */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  if (rel.length === 0) return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Identyfikatory z bazy trafiają do ścieżek, więc muszą być nieszkodliwe
 * nawet wtedy, gdy baza zostanie zmodyfikowana z zewnątrz.
 */
export function assertSafeSegment(segment: string): void {
  const safe = /^[A-Za-z0-9_-]{1,64}$/.test(segment)
  if (!safe) {
    throw new ApiError('PATH_INVALID', 'niedozwolony fragment ścieżki', 500)
  }
}

/**
 * Nazwa pliku wyjściowego (SPEC §7a, konwencja z briefu §4.8):
 * `<branza>-<slot>-<nr>.<ext>`. Wszystkie człony pochodzą z serwera,
 * żaden od klienta.
 */
export function buildOutputName(parts: {
  industry: string | null
  slug: string
  index: number
  extension: string
}): string {
  const industry = parts.industry === null ? 'sygnar' : parts.industry
  const number = String(parts.index).padStart(2, '0')
  return `${industry}-${parts.slug}-${number}.${parts.extension}`
}
