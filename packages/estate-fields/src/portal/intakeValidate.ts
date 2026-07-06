import { SHARED_FIELD_REGISTRY } from '../core/registry'
import { validateSharedField } from '../core/validate'
import type { SharedFieldId } from '../core/types'

const INTAKE_KEY_TO_FIELD_ID = new Map<string, SharedFieldId>(
  (Object.entries(SHARED_FIELD_REGISTRY) as [SharedFieldId, (typeof SHARED_FIELD_REGISTRY)[SharedFieldId]][])
    .filter(([, def]) => def.intakeKey)
    .map(([id, def]) => [def.intakeKey as string, id]),
)

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
