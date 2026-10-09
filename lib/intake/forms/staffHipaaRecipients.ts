import { z } from 'zod'

export const STAFF_HIPAA_RECIPIENTS = 'college_hipaa_recipients'
const recipientSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().max(500),
  relationship: z.string().trim().max(500),
  phone: z.string().trim().max(100),
  email: z.string().trim().max(320).refine(value => !value || z.string().email().safeParse(value).success, 'Enter a valid email address.'),
}).strict()
const recipientsSchema = z.array(recipientSchema).max(100)

/** Send only editable properties; saved metadata is merged server-side by ID. */
export function hipaaRecipientEditValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map(row => row && typeof row === 'object' && !Array.isArray(row)
    ? { id: row.id, name: row.name ?? '', relationship: row.relationship ?? '', phone: row.phone ?? '', email: row.email ?? '' }
    : row)
}

export function mergeStaffHipaaRecipients(value: unknown, stored: unknown): Record<string, unknown>[] {
  const parsed = recipientsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Check recipient details: use valid email addresses and no more than 100 recipients.')
  const ids = new Set(parsed.data.map(row => row.id))
  if (ids.size !== parsed.data.length) throw new Error('Each recipient must have a unique ID.')
  if (stored != null && (!Array.isArray(stored) || stored.some(row => !row || typeof row !== 'object' || Array.isArray(row)
    || typeof row.id !== 'string' || !row.id) || new Set(stored.map(row => row.id)).size !== stored.length)) {
    throw new Error('The saved recipient list needs review before editing.')
  }
  const previous = new Map<string, Record<string, unknown>>((stored ?? []).map((row: Record<string, unknown>) => [row.id as string, row]))
  return parsed.data.map(row => ({ ...previous.get(row.id), ...row }))
}

export function withStaffHipaaRecipients(data: Record<string, unknown>): Record<string, unknown> {
  const details = data.college_prep_details
  const nested = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).hipaa_recipients : undefined
  const recipients = data.college_hipaa_recipients ?? nested
  return { ...data, college_hipaa_recipients: Array.isArray(recipients) ? recipients.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [] }
}
