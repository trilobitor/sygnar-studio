import { defineConfig } from 'drizzle-kit'

/** Migracje trzymamy w repo — schemat zmienia się commitem, nie ręcznie w bazie. */
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'sqlite',
})
