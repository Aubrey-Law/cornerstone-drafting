import { IntegrationError } from '@/lib/integrations/errors'

/**
 * A 422 that names the attributes Lawmatics refused. `fields` holds attribute
 * names only, safe to persist; `details` holds Lawmatics' own wording, which
 * may echo a submitted value, so it is shown to staff but never stored.
 */
export class LawmaticsValidationError extends IntegrationError {
  readonly fields: string[]
  /** Custom field IDs Lawmatics reported as not found. */
  readonly customFieldIds: string[]
  declare readonly details: string[]

  constructor(fields: string[], details: string[], customFieldIds: string[] = []) {
    super({
      provider: 'lawmatics', kind: 'attention', code: 'validation_failed', retryAfterMs: null,
      safeMessage: fields.length
        ? `Lawmatics rejected these fields: ${fields.join(', ')}.`
        : 'Lawmatics rejected the supplied record fields.',
    })
    this.fields = fields
    this.customFieldIds = customFieldIds
    // Non-enumerable, so an accidental log or JSON.stringify of the error
    // never carries Lawmatics' wording (which may echo client data).
    Object.defineProperty(this, 'details', { value: details, enumerable: false })
  }
}

const MAX_DETAILS = 6
const MAX_DETAIL_LENGTH = 200

function attributeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // JSON:API pointers ("/data/attributes/marital_status"), dotted paths
  // ("custom_fields.0.value") and bare names all reduce to the attribute.
  const segments = value.split(/[/.[\]]+/).filter(Boolean)
  const index = segments.findIndex(segment => segment === 'attributes')
  const name = index >= 0 ? segments[index + 1] : segments.find(segment => !/^\d+$/.test(segment) && segment !== 'data')
  return name && /^[a-z][a-z0-9_]*$/i.test(name) ? name : null
}

function clip(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text
}

/** Reads the field names and messages out of JSON:API or Rails-style 422 bodies. */
const MISSING_CUSTOM_FIELD = /custom field with id ['"]?([^'"\s]+)['"]? not found/gi

export function parseLawmaticsValidation(body: unknown): { fields: string[]; details: string[]; customFieldIds: string[] } {
  const fields = new Set<string>()
  const details: string[] = []
  const addDetail = (value: unknown, field?: string | null) => {
    const text = clip(value)
    if (text && details.length < MAX_DETAILS) details.push(field && !text.toLowerCase().includes(field) ? `${field}: ${text}` : text)
  }
  const errors = body && typeof body === 'object' ? (body as Record<string, unknown>).errors : undefined
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (!entry || typeof entry !== 'object') { addDetail(entry); continue }
      const error = entry as Record<string, unknown>
      const source = (error.source && typeof error.source === 'object' ? error.source : {}) as Record<string, unknown>
      const field = attributeName(source.pointer) ?? attributeName(source.parameter)
        ?? attributeName(error.attribute) ?? attributeName(error.field)
      if (field) fields.add(field)
      addDetail(error.detail ?? error.title ?? error.message, field)
    }
  } else if (errors && typeof errors === 'object') {
    for (const [key, messages] of Object.entries(errors as Record<string, unknown>)) {
      const field = attributeName(key)
      if (field) fields.add(field)
      for (const message of Array.isArray(messages) ? messages : [messages]) addDetail(message, field)
    }
  }
  if (!details.length && body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    addDetail(record.message ?? record.error)
  }
  const customFieldIds = new Set<string>()
  for (const detail of details) {
    for (const match of detail.matchAll(MISSING_CUSTOM_FIELD)) customFieldIds.add(match[1])
  }
  if (customFieldIds.size) fields.add('custom_fields')
  return { fields: [...fields], details, customFieldIds: [...customFieldIds] }
}
