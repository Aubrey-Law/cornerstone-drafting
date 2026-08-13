import { SHARED_FIELD_REGISTRY } from '../core/registry'
import { validateSharedField } from '../core/validate'
import type { SharedFieldId } from '../core/types'

// Several intakeKeys are shared by a client field and its spouse/design twin
// (`email` on client_email and spouse_email, `state` on state and
// client_domicile, …). This map serves the CLIENT intake wizard, and the
// client-facing definition is registered first — so the first definition wins.
// A Map constructor would let the last one win, silently validating client
// input against the spouse/design rules.
const INTAKE_KEY_TO_FIELD_ID = new Map<string, SharedFieldId>()
for (const [id, def] of Object.entries(SHARED_FIELD_REGISTRY) as [SharedFieldId, (typeof SHARED_FIELD_REGISTRY)[SharedFieldId]][]) {
  if (!def.intakeKey) continue
  if (!INTAKE_KEY_TO_FIELD_ID.has(def.intakeKey)) {
    INTAKE_KEY_TO_FIELD_ID.set(def.intakeKey, id)
  }
}

/** Validate a client_intake column using the shared field registry. */
export function validateIntakeField(intakeKey: string, raw: unknown): string | null {
  const fieldId = INTAKE_KEY_TO_FIELD_ID.get(intakeKey)
  if (!fieldId) return null
  if (raw == null || raw === '') return null
  return validateSharedField(fieldId, raw)
}

export function sharedFieldIdForIntakeKey(intakeKey: string): SharedFieldId | null {
  return INTAKE_KEY_TO_FIELD_ID.get(intakeKey) ?? null
}
