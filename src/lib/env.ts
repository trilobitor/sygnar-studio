import { z } from 'zod'

/**
 * Walidacja konfiguracji przy starcie (SPEC §11). Brak wymaganej zmiennej =
 * aplikacja się nie uruchamia, zamiast wywrócić się przy pierwszym zapisie.
 *
 * Żadna z tych zmiennych nie ma prefiksu `NEXT_PUBLIC_` — klucz Anthropic
 * i ścieżki na dysku zostają po stronie serwera.
 */

const absolutePath = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('/'), {
    message: 'ścieżka musi być bezwzględna',
  })

const envSchema = z.object({
  /** Katalog danych: baza, zlecenia, wgrane pliki i eksporty. */
  STUDIO_DATA_DIR: absolutePath,

  /** Katalog `bin` środowiska mflux — stąd bierzemy `mflux-generate-flux2`. */
  MFLUX_BIN_DIR: absolutePath,

  FFMPEG_PATH: absolutePath,

  /**
   * Pusta wartość jest dozwolona: darktable dotyczy dopiero etapu E6,
   * a `/api/health` ma pokazać go jako jawnie brakującego, nie wywalić start.
   */
  DARKTABLE_CLI_PATH: z.string().default(''),

  /**
   * Też może być puste. Awaria warstwy promptowej nie blokuje generowania
   * (SPEC §6) — grafik wpisuje wtedy prompt ręcznie.
   */
  ANTHROPIC_API_KEY: z.string().default(''),

  /**
   * Ścieżka do Claude Code. Puste = domyślna z instalacji Homebrew.
   * Ta droga korzysta z subskrypcji zapisanej przez `claude`, więc nie
   * wymaga osobnego klucza API (decyzja D14).
   */
  CLAUDE_CLI_PATH: z.string().default(''),

  /**
   * Skąd bierzemy opis po angielsku:
   * - `auto`    — Claude Code, potem klucz API, na końcu składacz (domyślne)
   * - `cli`     — wyłącznie Claude Code
   * - `api`     — wyłącznie klucz API
   * - `builder` — wyłącznie składacz deterministyczny, bez sieci
   */
  PROMPT_BACKEND: z.enum(['auto', 'cli', 'api', 'builder']).default('auto'),

  /**
   * Skrót hasła dostępu w formacie `scrypt$<N>$<sól>$<skrót>`.
   * Hasła jawnym tekstem nie ma nigdzie — ani tu, ani w repozytorium.
   * Wygenerujesz nowy komendą `npm run haslo`.
   */
  STUDIO_PASSWORD_HASH: z.string().default(''),

  /**
   * Sekret podpisujący ciasteczko sesji. Zmiana unieważnia wszystkie
   * zalogowane sesje. Minimum 32 znaki — krótszy nie daje sensownego HMAC-a.
   */
  STUDIO_SESSION_SECRET: z.string().default(''),

  /**
   * Zostaje na przyszłość. Backendem wersji 1 jest mflux (decyzja D5),
   * ComfyUI dołoży się jako druga implementacja tego samego kontraktu.
   */
  COMFY_URL: z.string().url().optional(),

  MAX_CONCURRENT_GPU_JOBS: z.coerce.number().int().min(1).max(1).default(1),

  JOB_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(900_000),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(korzeń)'}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `Konfiguracja jest niekompletna, aplikacja się nie uruchomi.\n${problems}\n` +
        'Uzupełnij plik .env na podstawie .env.example.',
    )
  }

  return parsed.data
}

export const env: Env = loadEnv()

/**
 * Czy panel wymaga logowania.
 *
 * Bez skrótu hasła albo bez sekretu sesji zabezpieczenie jest wyłączone —
 * i tak ma być na `localhost`, gdzie sieć jest jedyną warstwą dostępu.
 * **Przed wystawieniem panelu poza sieć prywatną obie wartości muszą być
 * ustawione** (SPEC §13).
 */
export const requiresLogin =
  env.STUDIO_PASSWORD_HASH.length > 0 && env.STUDIO_SESSION_SECRET.length >= 32

/** Czy warstwa promptowa ma czym działać. Sprawdzane przez adapter `prompt`. */
export const hasAnthropicKey = env.ANTHROPIC_API_KEY.length > 0

/** Czy darktable jest w ogóle skonfigurowany. Dotyczy etapu E6. */
export const hasDarktable = env.DARKTABLE_CLI_PATH.length > 0
