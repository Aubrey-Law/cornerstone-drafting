import { createHash } from 'node:crypto'

/**
 * Helpers for logging about client data without logging client data.
 *
 * Server logs are retained by the hosting platform and read by anyone with
 * dashboard access, so they are outside the confidentiality boundary that the
 * database and R2 sit inside. A recipient address, an attendee's email, or the
 * value an attorney typed into a matter field must not appear there — but the
 * logs still have to be useful when something breaks, so each helper keeps a
 * stable, non-reversible handle on the thing it hides.
 */

/**
 * A short, stable digest of an identifier. The same address always produces the
 * same tag, so two log lines can be correlated, but the address cannot be
 * recovered from it.
 */
export function redactIdentifier(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return 'none'
  return `sha256:${createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`
}

/** Same, for a list of recipients: how many, and a tag for each. */
export function redactRecipients(values: readonly string[] | null | undefined): string {
  if (!values || values.length === 0) return 'none'
  return `${values.length}:${values.map(redactIdentifier).join(',')}`
}

/**
 * Describes a value's shape without disclosing it — for logs about a write that
 * failed, where the field name and the kind of value are diagnostic but the
 * content is the client's.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `string(len=${value.length})`
  if (typeof value === 'number' || typeof value === 'boolean') return typeof value
  if (Array.isArray(value)) return `array(len=${value.length})`
  if (typeof value === 'object') return `object(keys=${Object.keys(value as object).length})`
  return typeof value
}
