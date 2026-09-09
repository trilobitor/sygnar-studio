/**
 * Zarządzanie dostępem do panelu z wiersza poleceń.
 *
 *   npm run dostep -- lista
 *   npm run dostep -- dodaj Oliwia
 *   npm run dostep -- odbierz Oliwia
 *   npm run dostep -- przywroc Oliwia
 *   npm run dostep -- wyloguj Oliwia    # unieważnia jej sesje na wszystkich urządzeniach
 *   npm run dostep -- wejscia [ile]
 *
 * Hasło podaje się na wejściu, nie w argumencie — argumenty widać w `ps`
 * i zostają w historii powłoki.
 *
 * Skrypt rozmawia z bazą wprost, tak samo jak `migrate.mts`, zamiast sięgać
 * po `services/users.ts`. Tamten moduł importuje przez alias `@/`, którego
 * `node` poza Nextem nie rozwiązuje.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import pkg from '@next/env'
import Database from 'better-sqlite3'

import { hashPassword, verifyPassword } from '../services/password.ts'

pkg.loadEnvConfig(process.cwd())

const dataDir = process.env.STUDIO_DATA_DIR
if (dataDir === undefined || dataDir.length === 0) {
  throw new Error('brak STUDIO_DATA_DIR — uruchom z katalogu projektu')
}

const baza = new Database(join(dataDir, 'studio.db'))
baza.exec('PRAGMA foreign_keys = ON')

interface Wiersz {
  id: string
  name: string
  password_hash: string
  created_at: number
  disabled_at: number | null
}

const [polecenie, ...reszta] = process.argv.slice(2)

function data(ms: number): string {
  return new Date(ms).toLocaleString('pl-PL')
}

function osoby(): Wiersz[] {
  return baza.prepare('SELECT * FROM users ORDER BY created_at').all() as Wiersz[]
}

async function zapytajOHaslo(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const haslo = await rl.question('Hasło dla nowej osoby: ')
  rl.close()

  // Panel stoi w internecie, więc krótkie hasło nie jest tu kwestią gustu.
  if (haslo.trim().length < 12) {
    throw new Error('hasło krótsze niż 12 znaków — panel jest wystawiony publicznie')
  }

  return haslo.trim()
}

switch (polecenie) {
  case 'lista': {
    const lista = osoby()
    if (lista.length === 0) {
      console.log('Nikt nie ma jeszcze dostępu.')
      break
    }
    for (const o of lista) {
      const stan = o.disabled_at === null ? '✓ czynny ' : '✗ odebrany'
      console.log(`${stan}  ${o.name.padEnd(16)} od ${data(o.created_at)}`)
    }
    break
  }

  case 'dodaj': {
    const imie = reszta[0]
    if (imie === undefined) throw new Error('podaj imię: npm run dostep -- dodaj Oliwia')

    const lista = osoby()
    if (lista.some((o) => o.name === imie)) throw new Error(`${imie} już jest na liście`)

    const haslo = await zapytajOHaslo()

    // To samo hasło u dwóch osób sprawiłoby, że log wejść wskazuje nie tę
    // osobę co trzeba — a to jedyny powód, dla którego ten log istnieje.
    for (const o of lista) {
      if (await verifyPassword(haslo, o.password_hash)) {
        throw new Error(`tego hasła używa już: ${o.name}`)
      }
    }

    baza
      .prepare(
        'INSERT INTO users (id, name, password_hash, created_at, disabled_at) VALUES (?, ?, ?, ?, NULL)',
      )
      .run(randomUUID(), imie, await hashPassword(haslo), Date.now())

    console.log(`Dodano: ${imie}`)
    break
  }

  case 'odbierz': {
    const imie = reszta[0]
    if (imie === undefined) throw new Error('podaj imię: npm run dostep -- odbierz Oliwia')

    // Sesja tej osoby przestaje działać przy następnym żądaniu — bramka pyta
    // bazę, czy osoba jest czynna, więc nie czekamy na wygaśnięcie ciasteczka.
    const wynik = baza
      .prepare('UPDATE users SET disabled_at = ? WHERE name = ? AND disabled_at IS NULL')
      .run(Date.now(), imie)

    console.log(wynik.changes > 0 ? `Odebrano dostęp: ${imie}` : `Nie ma czynnej osoby: ${imie}`)
    break
  }

  case 'przywroc': {
    const imie = reszta[0]
    if (imie === undefined) throw new Error('podaj imię: npm run dostep -- przywroc Oliwia')

    // Przywracamy zamiast dodawać od nowa, żeby log wejść sprzed odebrania
    // nadal wskazywał tę samą osobę, a nie osierocony wpis.
    const wynik = baza
      .prepare('UPDATE users SET disabled_at = NULL WHERE name = ? AND disabled_at IS NOT NULL')
      .run(imie)

    console.log(wynik.changes > 0 ? `Przywrócono dostęp: ${imie}` : `Nie ma odebranego: ${imie}`)
    break
  }

  case 'wyloguj': {
    const imie = reszta[0]
    if (imie === undefined) throw new Error('podaj imię: npm run dostep -- wyloguj Oliwia')

    // Unieważnia sesje wydane przed tą chwilą. Osoba zachowuje dostęp —
    // musi się tylko zalogować ponownie. Do tej pory jedynym sposobem na
    // wyrzucenie kogoś z cudzego urządzenia było odebranie dostępu w całości.
    const wynik = baza
      .prepare('UPDATE users SET sessions_valid_from = ? WHERE name = ?')
      .run(Date.now(), imie)

    console.log(wynik.changes > 0 ? `Wylogowano wszędzie: ${imie}` : `Nie ma takiej osoby: ${imie}`)
    break
  }

  case 'wejscia': {
    const ile = Number(reszta[0] ?? '30')
    const wiersze = baza
      .prepare(
        `SELECT e.created_at, e.outcome, e.client_hash, u.name
         FROM login_events e LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC LIMIT ?`,
      )
      .all(Number.isFinite(ile) ? ile : 30) as {
      created_at: number
      outcome: string
      client_hash: string
      name: string | null
    }[]

    if (wiersze.length === 0) {
      console.log('Log wejść jest pusty.')
      break
    }

    for (const w of wiersze) {
      console.log(
        `${data(w.created_at).padEnd(20)} ${w.outcome.padEnd(12)} ${(w.name ?? '—').padEnd(16)} ${w.client_hash}`,
      )
    }
    break
  }

  default:
    console.log(
      'Użycie: npm run dostep -- lista | dodaj <imię> | odbierz <imię> | przywroc <imię> | wyloguj <imię> | wejscia [ile]',
    )
    process.exitCode = 1
}

baza.close()
