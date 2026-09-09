/**
 * Jedna komenda zamiast sześciu rozproszonych sprawdzeń.
 *
 *   npm run doktor
 *
 * Wypisuje sześć wierszy z jednoznacznym werdyktem i kończy się kodem 1,
 * gdy cokolwiek jest nie tak — dzięki temu nadaje się do cron-a i do
 * sprawdzenia „czy panel w ogóle wstanie", zanim grafik zacznie pracę.
 *
 * Dotąd te rzeczy sprawdzało się osobno albo wcale: konfigurację dopiero
 * przy starcie serwera, spójność bazy nigdy, wiek kopii zapasowej wzrokiem
 * w Finderze, a obecność binarek dopiero przy pierwszym zadaniu grafika.
 */
import { execFile } from 'node:child_process'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import pkg from '@next/env'
import Database from 'better-sqlite3'

// Musi stać przed pierwszym importem kodu aplikacji — rejestruje alias `@/`.
import './alias.mts'

const uruchom = promisify(execFile)

pkg.loadEnvConfig(process.cwd())

type Werdykt = 'ok' | 'uwaga' | 'zle'

const ZNAK: Record<Werdykt, string> = { ok: '✓', uwaga: '!', zle: '✗' }

/*
 * Najgorszy dotychczasowy werdykt trzymamy w polu obiektu, nie w `let`.
 * Kompilator zawęża zwykłą zmienną do wartości początkowej i nie widzi
 * przypisań robionych wewnątrz `wypisz`, przez co końcowe porównanie
 * uznawał za bezcelowe.
 */
const stan: { najgorszy: Werdykt } = { najgorszy: 'ok' }

function wypisz(nazwa: string, werdykt: Werdykt, szczegol: string): void {
  if (werdykt === 'zle' || (werdykt === 'uwaga' && stan.najgorszy === 'ok')) {
    stan.najgorszy = werdykt
  }

  console.log(`${ZNAK[werdykt]} ${nazwa.padEnd(16)} ${szczegol}`)
}

function czytelnie(bajty: number): string {
  return bajty >= 1024 ** 3
    ? `${(bajty / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bajty / 1024 ** 2)} MB`
}

// --- 1. konfiguracja ------------------------------------------------------
// Schemat z `src/lib/env.ts` jest źródłem prawdy; ładujemy go dynamicznie,
// żeby skrypt nie ciągnął za sobą całego drzewa importów aplikacji.
let dataDir = ''

try {
  const { env } = (await import('../src/lib/env.ts')) as { env: { STUDIO_DATA_DIR: string } }
  dataDir = env.STUDIO_DATA_DIR
  wypisz('konfiguracja', 'ok', 'wszystkie wymagane zmienne obecne i poprawne')
} catch (blad) {
  const powod = blad instanceof Error ? blad.message.split('\n')[0] : 'nieznany błąd'
  wypisz('konfiguracja', 'zle', powod ?? 'nieznany błąd')
}

// --- 2. baza --------------------------------------------------------------
if (dataDir !== '') {
  try {
    const plik = join(dataDir, 'studio.db')
    const baza = new Database(plik, { readonly: true })

    const kontrola = baza.pragma('quick_check', { simple: true })

    // Migracje zastosowane w bazie kontra te, które leżą w repozytorium.
    // Rozjazd znaczy, że panel wstanie i wywali się dopiero na zapytaniu.
    const zastosowane = baza
      .prepare('SELECT COUNT(*) AS ile FROM __drizzle_migrations')
      .get() as { ile: number } | undefined

    baza.close()

    const dziennik = JSON.parse(
      readFileSync('src/server/db/migrations/meta/_journal.json', 'utf8'),
    ) as { entries: unknown[] }

    const wRepo = dziennik.entries.length
    const wBazie = zastosowane?.ile ?? 0

    if (kontrola !== 'ok') {
      wypisz('baza', 'zle', `quick_check zgłasza uszkodzenie: ${String(kontrola)}`)
    } else if (wBazie !== wRepo) {
      wypisz('baza', 'zle', `migracje rozjechane: ${wBazie} w bazie, ${wRepo} w repozytorium`)
    } else {
      wypisz('baza', 'ok', `spójna, ${wBazie} migracji zastosowanych`)
    }
  } catch {
    wypisz('baza', 'zle', `nie da się otworzyć pliku ${join(dataDir, 'studio.db')}`)
  }
}

// --- 3. katalog danych ----------------------------------------------------
if (dataDir !== '') {
  try {
    const { size } = await uruchom('du', ['-sk', dataDir]).then((wynik) => ({
      size: Number.parseInt(wynik.stdout.split('\t')[0] ?? '0', 10) * 1024,
    }))

    // Zapisywalność sprawdzamy prawdziwym zapisem, nie `access(W_OK)`:
    // uprawnienia mogą się zgadzać przy dysku zamontowanym tylko do odczytu.
    const { writeFileSync, unlinkSync } = await import('node:fs')
    const probka = join(dataDir, '.probka-doktora')

    writeFileSync(probka, 'x')
    unlinkSync(probka)

    wypisz('katalog danych', 'ok', `zapisywalny, zajmuje ${czytelnie(size)}`)
  } catch {
    wypisz('katalog danych', 'zle', `nie istnieje albo nie da się w nim zapisywać: ${dataDir}`)
  }
}

// --- 4. wolne miejsce -----------------------------------------------------
if (dataDir !== '') {
  try {
    const { stdout } = await uruchom('df', ['-k', dataDir])
    const wiersz = stdout.trim().split('\n')[1] ?? ''
    const wolneKb = Number.parseInt(wiersz.split(/\s+/)[3] ?? '0', 10)
    const wolne = wolneKb * 1024

    // Jedno generowanie 2,08 Mpx zjada dziesiątki gigabajtów pamięci, ale na
    // dysku liczą się kadry i montaże: 5 GB to około dwustu kadrów.
    const werdykt: Werdykt = wolne < 5 * 1024 ** 3 ? 'zle' : wolne < 20 * 1024 ** 3 ? 'uwaga' : 'ok'

    wypisz('wolne miejsce', werdykt, `${czytelnie(wolne)} na dysku z danymi`)
  } catch {
    wypisz('wolne miejsce', 'uwaga', 'nie udało się odczytać')
  }
}

// --- 5. narzędzia zewnętrzne ---------------------------------------------
try {
  const { collectHealth } = (await import('../src/server/services/health.ts')) as {
    collectHealth: () => Promise<{
      ready: boolean
      adapters: { label: string; status: { ok: boolean } }[]
    }>
  }

  const raport = await collectHealth()
  const zepsute = raport.adapters.filter((adapter) => !adapter.status.ok)

  if (zepsute.length === 0) {
    wypisz('narzędzia', 'ok', `${raport.adapters.length} sprawdzeń, wszystkie zdrowe`)
  } else {
    // `ready` odróżnia awarię blokującą od braku, z którym da się pracować:
    // bez darktable panel działa, bez generatora albo bazy nie.
    wypisz(
      'narzędzia',
      raport.ready ? 'uwaga' : 'zle',
      `${raport.ready ? 'nie blokuje pracy, brakuje' : 'praca niemożliwa, nie działa'}: ${zepsute
        .map((adapter) => adapter.label)
        .join(', ')}`,
    )
  }
} catch (blad) {
  wypisz('narzędzia', 'zle', blad instanceof Error ? blad.message : 'sprawdzenie się wywróciło')
}

// --- 6. kopia zapasowa ----------------------------------------------------
try {
  const katalog = join(process.env.HOME ?? '.', 'Sygnar', 'kopie')
  const dni = readdirSync(katalog)
    .map((nazwa) => ({ nazwa, czas: statSync(join(katalog, nazwa)).mtimeMs }))
    .sort((a, b) => b.czas - a.czas)

  const najnowsza = dni[0]

  if (najnowsza === undefined) {
    wypisz('kopia zapasowa', 'zle', 'nie ma ani jednej — uruchom `npm run kopia`')
  } else {
    const godziny = (Date.now() - najnowsza.czas) / 3_600_000
    const werdykt: Werdykt = godziny > 24 * 7 ? 'zle' : godziny > 48 ? 'uwaga' : 'ok'

    wypisz(
      'kopia zapasowa',
      werdykt,
      godziny < 48
        ? `najnowsza sprzed ${Math.round(godziny)} h (${najnowsza.nazwa})`
        : `najnowsza sprzed ${Math.round(godziny / 24)} dni (${najnowsza.nazwa})`,
    )
  }
} catch {
  wypisz('kopia zapasowa', 'zle', 'katalog ~/Sygnar/kopie nie istnieje')
}

process.exit(stan.najgorszy === 'zle' ? 1 : 0)
