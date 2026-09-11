/**
 * Kopia zapasowa katalogu danych.
 *
 *   npm run kopia                      # do ~/Sygnar/kopie
 *   npm run kopia -- /Volumes/Dysk     # na dysk zewnętrzny
 *
 * Robi dwie rzeczy:
 *
 * 1. Spójny zrzut bazy przez `database.backup()`, **nie** przez kopiowanie
 *    pliku. Baza chodzi w trybie WAL, więc świeże zapisy leżą w dzienniku,
 *    a nie w samym `.db`. Sprawdzone doświadczalnie: skopiowanie pliku bazy
 *    z 500 wierszami dało kopię, w której tabela w ogóle nie istniała —
 *    wszystko siedziało jeszcze w WAL.
 *
 * 2. Zsynchronizowanie katalogu `orders/` — tam leżą kadry, montaże i pliki
 *    oddane klientom. Sam wiersz w bazie bez pliku PNG jest bezużyteczny,
 *    i odwrotnie.
 *
 * Retencja: 7 kopii dziennych i 4 tygodniowe. Starsze kasujemy, bo katalog
 * danych waży dziś 138 MB i bez sprzątania kopie zjadłyby dysk.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import pkg from '@next/env'
import Database from 'better-sqlite3'

const uruchom = promisify(execFile)

pkg.loadEnvConfig(process.cwd())

const zrodlo = process.env.STUDIO_DATA_DIR
if (zrodlo === undefined || zrodlo.length === 0) {
  throw new Error('brak STUDIO_DATA_DIR — uruchom z katalogu projektu')
}

const cel = process.argv[2] ?? join(process.env.HOME ?? '.', 'Sygnar', 'kopie')

/** Znacznik dnia w nazwie, żeby kopie z jednego dnia się nadpisywały. */
function dzien(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function czytelnie(bajty: number): string {
  return bajty > 1024 * 1024 * 1024
    ? `${(bajty / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.round(bajty / 1024 / 1024)} MB`
}

const katalog = join(cel, dzien())
mkdirSync(katalog, { recursive: true })

console.error(`Kopia do ${katalog}`)

// --- baza ---------------------------------------------------------------
const baza = new Database(join(zrodlo, 'studio.db'), { readonly: true })
const plikBazy = join(katalog, 'studio.db')

await baza.backup(plikBazy)
baza.close()

const wielkoscBazy = statSync(plikBazy).size
console.error(`  baza: ${czytelnie(wielkoscBazy)}`)

// Kopia bez możliwości otwarcia jest bezwartościowa, a wychodzi to na jaw
// dopiero przy odtwarzaniu — czyli w najgorszym możliwym momencie.
const sprawdzenie = new Database(plikBazy, { readonly: true })
const ile = sprawdzenie.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number }
const integralnosc = sprawdzenie.pragma('quick_check', { simple: true })
sprawdzenie.close()

if (integralnosc !== 'ok') {
  throw new Error(`kopia bazy nie przechodzi quick_check: ${String(integralnosc)}`)
}

console.error(`  sprawdzona: ${ile.c} zleceń, quick_check ok`)

// --- pliki --------------------------------------------------------------
await uruchom('rsync', ['-a', '--delete', join(zrodlo, 'orders') + '/', join(katalog, 'orders')])

const { stdout } = await uruchom('du', ['-sk', join(katalog, 'orders')])
const kb = Number(stdout.trim().split(/\s+/)[0] ?? '0')
console.error(`  pliki: ${czytelnie(kb * 1024)}`)

/*
 * Dokumentacja audytu, jeśli jest.
 *
 * `audyt/` jest świadomie poza repozytorium — to mapa niezałatanych słabości
 * aplikacji stojącej pod publicznym adresem, a repozytorium jest publiczne
 * (decyzja właściciela z 11.09.2026, opisana w `.gitignore`). Skutek uboczny
 * tamtej decyzji był taki, że katalogu nie chronił **ani git, ani kopia** —
 * jeden egzemplarz na jednym dysku. Kopia zapasowa jest jedynym miejscem,
 * w którym da się to naprawić bez wypychania rejestru na GitHub.
 *
 * Katalog może nie istnieć — na innej maszynie albo po jego uprzątnięciu.
 * Brak nie jest błędem kopii.
 */
const audyt = join(process.cwd(), 'audyt')

if (existsSync(audyt)) {
  await uruchom('rsync', ['-a', '--delete', audyt + '/', join(katalog, 'audyt')])

  const { stdout: wyjscieAudytu } = await uruchom('du', ['-sk', join(katalog, 'audyt')])
  const kbAudytu = Number(wyjscieAudytu.trim().split(/\s+/)[0] ?? '0')
  console.error(`  audyt: ${czytelnie(kbAudytu * 1024)}`)
}

// --- retencja -----------------------------------------------------------
/**
 * Zostawiamy 7 ostatnich kopii dziennych i po jednej z każdego z 4 ostatnich
 * tygodni. Awaria zauważona po miesiącu jest równie prawdopodobna jak ta
 * zauważona nazajutrz — a bez kopii tygodniowych ta pierwsza nie ma z czego
 * wracać.
 */
function tydzien(data: string): string {
  const d = new Date(data)
  const poniedzialek = new Date(d)
  poniedzialek.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return poniedzialek.toISOString().slice(0, 10)
}

const kopie = readdirSync(cel)
  .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
  .sort()
  .reverse()

const zostaw = new Set(kopie.slice(0, 7))
const tygodnie = new Set<string>()

for (const k of kopie) {
  const t = tydzien(k)
  if (tygodnie.size < 4 && !tygodnie.has(t)) {
    tygodnie.add(t)
    zostaw.add(k)
  }
}

let usunietych = 0
for (const k of kopie) {
  if (zostaw.has(k)) continue
  rmSync(join(cel, k), { recursive: true, force: true })
  usunietych += 1
}

console.error(`  kopii na dysku: ${zostaw.size}${usunietych > 0 ? `, usuniętych: ${usunietych}` : ''}`)
console.error('Gotowe.')
