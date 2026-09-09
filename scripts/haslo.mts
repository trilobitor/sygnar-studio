import { createInterface } from 'node:readline/promises'

import { hashPassword } from '../src/server/services/password.ts'

/**
 * Generator skrótu hasła do `.env`.
 *
 * Hasło czytamy ze standardowego wejścia, nie z argumentu wywołania —
 * argumenty widać w `ps` i zostają w historii powłoki.
 *
 * Użycie:
 *   npm run haslo
 *   echo -n 'twoje-haslo' | npm run haslo
 */

const stdinIsPipe = !process.stdin.isTTY

async function readPassword(): Promise<string> {
  if (stdinIsPipe) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await rl.question('Hasło do panelu: ')
  rl.close()
  return answer
}

const password = await readPassword()

if (password.length < 8) {
  process.stderr.write('Hasło musi mieć co najmniej 8 znaków.\n')
  process.exit(1)
}

const hash = await hashPassword(password)

process.stderr.write('\nWklej do .env:\n\n')
process.stdout.write(`STUDIO_PASSWORD_HASH=${hash}\n`)
