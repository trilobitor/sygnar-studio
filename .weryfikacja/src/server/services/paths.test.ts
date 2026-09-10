import { describe, expect, it } from 'vitest'

import { ApiError } from '@/server/adapters/types'
import {
  assertSafeSegment,
  bucketDir,
  buildOutputName,
  isInside,
  orderDir,
  resolveAssetPath,
  toRelativePath,
} from './paths'

/**
 * Budowanie ścieżek jest testem obowiązkowym (SPEC §14), łącznie z próbami
 * wyjścia poza katalog danych. Brak tej weryfikacji to odczyt dowolnego
 * pliku z dysku, więc testy są tu ważniejsze niż gdziekolwiek indziej.
 */

const DATA_DIR = '/dane/studio'
const ORDER_ID = 'ab12cd34-ef56'

describe('składanie ścieżek', () => {
  it('składa katalog zlecenia wewnątrz katalogu danych', () => {
    expect(orderDir(DATA_DIR, ORDER_ID)).toBe('/dane/studio/orders/ab12cd34-ef56')
  })

  it('składa katalogi na pliki wygenerowane, wgrane i eksporty', () => {
    expect(bucketDir(DATA_DIR, ORDER_ID, 'generated')).toBe(
      '/dane/studio/orders/ab12cd34-ef56/generated',
    )
    expect(bucketDir(DATA_DIR, ORDER_ID, 'uploads')).toBe(
      '/dane/studio/orders/ab12cd34-ef56/uploads',
    )
    expect(bucketDir(DATA_DIR, ORDER_ID, 'exports')).toBe(
      '/dane/studio/orders/ab12cd34-ef56/exports',
    )
  })

  it('rozwija poprawną ścieżkę względną', () => {
    expect(resolveAssetPath(DATA_DIR, 'orders/abc/generated/kadr.png')).toBe(
      '/dane/studio/orders/abc/generated/kadr.png',
    )
  })

  it('zwija ścieżkę bezwzględną z powrotem do względnej', () => {
    expect(toRelativePath(DATA_DIR, '/dane/studio/orders/abc/kadr.png')).toBe(
      'orders/abc/kadr.png',
    )
  })
})

describe('próby wyjścia poza katalog danych', () => {
  const escapes = [
    '../../etc/passwd',
    'orders/../../../etc/passwd',
    'orders/abc/../../../../etc/passwd',
    './../../root/.ssh/id_rsa',
    'orders/abc/generated/../../../../../../etc/hosts',
  ]

  it.each(escapes)('odrzuca ścieżkę %s', (candidate) => {
    expect(() => resolveAssetPath(DATA_DIR, candidate)).toThrow(ApiError)
  })

  it('odrzuca ścieżkę bezwzględną z bazy', () => {
    expect(() => resolveAssetPath(DATA_DIR, '/etc/passwd')).toThrow(ApiError)
  })

  it('nie daje się nabrać na katalog o wspólnym przedrostku', () => {
    // `/dane/studio-inne` zaczyna się od `/dane/studio`, ale w nim nie leży.
    expect(isInside('/dane/studio', '/dane/studio-inne/plik.png')).toBe(false)
    expect(() => toRelativePath(DATA_DIR, '/dane/studio-inne/plik.png')).toThrow(ApiError)
  })

  it('uznaje sam katalog danych za leżący w sobie', () => {
    expect(isInside('/dane/studio', '/dane/studio')).toBe(true)
  })

  it('rzuca kodem PATH_INVALID, nie treścią dla użytkownika', () => {
    try {
      resolveAssetPath(DATA_DIR, '../../etc/passwd')
      expect.unreachable('powinno rzucić')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe('PATH_INVALID')
    }
  })
})

describe('fragmenty ścieżki z bazy', () => {
  it.each(['abc', 'ab12cd34-ef56', 'A_B-1'])('przepuszcza %s', (segment) => {
    expect(() => assertSafeSegment(segment)).not.toThrow()
  })

  it.each(['..', '../x', 'a/b', 'a\\b', '', 'a b', 'ą', 'a'.repeat(65)])(
    'odrzuca %s',
    (segment) => {
      expect(() => assertSafeSegment(segment)).toThrow(ApiError)
    },
  )

  it('odrzuca identyfikator zlecenia z separatorem katalogów', () => {
    expect(() => orderDir(DATA_DIR, '../../etc')).toThrow(ApiError)
  })
})

describe('nazwy plików wyjściowych', () => {
  it('składa nazwę z branży, slotu i numeru', () => {
    expect(buildOutputName({ industry: 'legal', slug: 'services', index: 1, extension: 'webp' })).toBe(
      'legal-services-01.webp',
    )
  })

  it('podstawia markę, gdy zlecenie nie ma branży', () => {
    expect(buildOutputName({ industry: null, slug: 'hero', index: 12, extension: 'avif' })).toBe(
      'sygnar-hero-12.avif',
    )
  })
})
