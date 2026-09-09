import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { zbudujZip } from './zip'

const uruchom = promisify(execFile)

/**
 * Archiwum ZIP.
 *
 * Testy nie sprawdzają, czy bajty wyglądają „mniej więcej dobrze" — sprawdzają,
 * czy systemowy `unzip` potrafi je rozpakować i czy zawartość wraca bit
 * w bit. Własny zapis formatu bez takiej kontroli byłby zgadywaniem.
 */
describe('archiwum do oddania', () => {
  it('systemowy unzip odtwarza pliki co do bajtu', async () => {
    const katalog = await mkdtemp(join(tmpdir(), 'zip-'))
    const archiwum = join(katalog, 'paczka.zip')

    const tresc = Buffer.from('Kadr do oddania — ćwierć, żółw, ŁÓDŹ\n'.repeat(50), 'utf8')
    const drugi = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])

    await writeFile(
      archiwum,
      zbudujZip([
        { nazwa: 'legal-services-01.avif', dane: tresc },
        { nazwa: 'karta-kontrolna.txt', dane: drugi },
      ]),
    )

    await uruchom('unzip', ['-o', archiwum, '-d', katalog])

    expect(await readFile(join(katalog, 'legal-services-01.avif'))).toEqual(tresc)
    expect(await readFile(join(katalog, 'karta-kontrolna.txt'))).toEqual(drugi)
  })

  it('unzip nie zgłasza uszkodzenia archiwum', async () => {
    const katalog = await mkdtemp(join(tmpdir(), 'zip-'))
    const archiwum = join(katalog, 'kontrola.zip')

    await writeFile(archiwum, zbudujZip([{ nazwa: 'a.txt', dane: Buffer.from('x') }]))

    // `unzip -t` sprawdza sumy kontrolne każdego wpisu i kończy się zerem
    // tylko wtedy, gdy wszystkie się zgadzają.
    const { stdout } = await uruchom('unzip', ['-t', archiwum])

    expect(stdout).toContain('No errors detected')
  })

  it('puste archiwum jest rozpoznawalnym pustym archiwum, nie śmieciem', async () => {
    const katalog = await mkdtemp(join(tmpdir(), 'zip-'))
    const archiwum = join(katalog, 'puste.zip')
    const bajty = zbudujZip([])

    await writeFile(archiwum, bajty)

    // Sam rekord zamykający: dwadzieścia dwa bajty z sygnaturą PK\x05\x06.
    expect(bajty).toHaveLength(22)
    expect(bajty.readUInt32LE(0)).toBe(0x06054b50)

    // `unzip` kończy się kodem różnym od zera przy pustym archiwum, więc
    // łapiemy błąd i sprawdzamy komunikat — chodzi o to, żeby narzędzie
    // rozpoznało format, a nie odbiło pliku jako uszkodzonego.
    const wynik = await uruchom('unzip', ['-l', archiwum]).catch((blad: unknown) => blad)
    const tresc = JSON.stringify(wynik)

    expect(tresc).toContain('zipfile is empty')
    expect(tresc).not.toContain('cannot find zipfile directory')
  })
})
