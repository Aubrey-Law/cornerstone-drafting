import { getSharedField } from './registry'
import { isValidEmail, trimString } from './normalize'
import type { SharedFieldId } from './types'

export function validateSharedField(id: SharedFieldId, raw: unknown): string | null {
  const def = getSharedField(id)
  const value = def.normalize ? def.normalize(raw) : trimString(raw)

  if (def.control === 'email' && value && !isValidEmail(value)) {
    return 'Enter a valid email address.'
  }

  if (def.control === 'select' && value && def.options?.length) {
    const allowed = new Set(def.options.map((o) => o.value))
    for (const legacy of def.legacyValues ?? []) allowed.add(legacy)
    if (!allowed.has(value)) {
      return `Select a valid ${def.label.toLowerCase()}.`
    }
  }

  return null
}
