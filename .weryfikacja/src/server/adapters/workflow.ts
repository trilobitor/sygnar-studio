import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

/**
 * Wczytanie zamrożonych parametrów modelu z `workflows/` (SPEC §7a).
 *
 * Kroki i guidance są liczbami w pliku JSON, nie w kodzie i nie w prompcie.
 * Warstwa promptowa nie ma do nich dostępu i nie może ich zmienić — to jest
 * różnica między prośbą do modelu a parametrem aplikacji.
 */

const workflowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  engine: z.literal('mflux'),
  generator: z.string().min(1),
  model: z.string().min(1),
  steps: z.number().int().min(1).max(50),
  guidance: z.number().min(0).max(20),
  notes: z.array(z.string()).default([]),
})

export type Workflow = z.infer<typeof workflowSchema>

const cache = new Map<string, Workflow>()

/**
 * Wczytuje i waliduje preset. Odczyt jest synchroniczny i zapamiętany —
 * plik jest mały, a zmienia się wyłącznie commitem, nie w trakcie pracy.
 */
export function loadWorkflow(id: string): Workflow {
  const cached = cache.get(id)
  if (cached !== undefined) return cached

  // Nazwa presetu pochodzi ze stałej w kodzie, nigdy od klienta.
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`niedozwolony identyfikator presetu: ${id}`)
  }

  const raw = readFileSync(join(process.cwd(), 'workflows', `${id}.json`), 'utf8')
  const parsed = workflowSchema.parse(JSON.parse(raw))

  cache.set(id, parsed)
  return parsed
}

/** Preset używany do generowania obrazu z opisu. */
export const TEXT_TO_IMAGE_WORKFLOW = 'flux2-klein-t2i'

/** Preset używany do poprawiania istniejącego kadru. */
export const IMAGE_EDIT_WORKFLOW = 'flux2-klein-edit'
