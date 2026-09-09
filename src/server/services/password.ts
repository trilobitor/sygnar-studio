import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Hasło dostępu do panelu (SPEC §13).
 *
 * W repozytorium ani w konfiguracji nie ma hasła jawnym tekstem — jest
 * wyłącznie skrót. `scrypt` jest celowo wolny i pamięciożerny, więc łamanie
 * skrótu słownikiem kosztuje realny czas, a nie ułamek sekundy jak przy SHA.
 *
 * Format zapisu: `scrypt:<N>:<sól hex>:<skrót hex>`.
 *
 * Separatorem jest dwukropek, **nie dolar**. Next rozwija `$nazwa` w plikach
 * `.env` jak zmienną powłoki, więc skrót z dolarami docierał do aplikacji
 * obcięty do samego słowa „scrypt". Sprawdzone loaderem `@next/env`.
 */

/** Koszt pracy. 2^17 to około 100 ms na tej maszynie — do wyczucia przy
 *  jednym logowaniu, dotkliwe przy milionie prób. */
const COST = 2 ** 17
const KEY_LENGTH = 64
const SALT_BYTES = 16

/**
 * `scrypt` przy koszcie 2^17 potrzebuje więcej pamięci niż domyślne 32 MB,
 * inaczej Node odrzuca wywołanie błędem o przekroczeniu limitu.
 */
const SCRYPT_OPTIONS: ScryptOptions = { N: COST, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

/**
 * `promisify(scrypt)` gubi wariant z opcjami — jego typy znają tylko wersję
 * trzyargumentową. Zawijamy sami, zamiast obchodzić to rzutowaniem.
 */
function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error !== null) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await derive(password, salt, KEY_LENGTH, SCRYPT_OPTIONS)
  return `scrypt:${COST}:${salt.toString('hex')}:${derived.toString('hex')}`
}

/**
 * Porównanie w czasie stałym. Zwykłe `===` na skrótach pozwalałoby zgadywać
 * hasło znak po znaku, mierząc czas odpowiedzi.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')

  if (parts.length !== 4 || parts[0] !== 'scrypt') return false

  const cost = Number(parts[1])
  const saltHex = parts[2]
  const hashHex = parts[3]

  if (!Number.isFinite(cost) || saltHex === undefined || hashHex === undefined) return false

  try {
    const expected = Buffer.from(hashHex, 'hex')
    const derived = await derive(password, Buffer.from(saltHex, 'hex'), expected.length, {
      ...SCRYPT_OPTIONS,
      N: cost,
    })

    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    // Uszkodzony wpis w konfiguracji to brak dostępu, nie awaria aplikacji.
    return false
  }
}
