import { getSharedField } from './registry'
import { trimString } from './normalize'
import type { SharedFieldId } from './types'

export function syncFieldToDesign(id: SharedFieldId, raw: unknown): string | null {
  const def = getSharedField(id)
  if (def.intakeToDesign) return def.intakeToDesign(raw)
  if (def.normalize) return def.normalize(raw)
  return trimString(raw)
}

export function normalizeDesignFieldValue(id: SharedFieldId, raw: unknown): string | null {
  const def = getSharedField(id)
  if (def.normalize) return def.normalize(raw)
  return trimString(raw)
}
