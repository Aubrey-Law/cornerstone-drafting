import { z } from 'zod'
import { formatPhoneForStorage } from '@/lib/phone'

export const STAFF_CONTACT_FIELDS = [
  ['first_name', 'First name'], ['middle_name', 'Middle name'], ['last_name', 'Last name'],
  ['suffix', 'Suffix'], ['preferred_pronoun', 'Pronouns'], ['email', 'Email'], ['phone', 'Phone'],
  ['address_line1', 'Street address'], ['address_line2', 'Address line 2'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
] as const
const fields = Object.fromEntries(STAFF_CONTACT_FIELDS.map(([key]) => [key, z.string().max(2000).nullable()]))
const snapshotSchema = z.object(fields).strict()
export const staffContactEditSchema = z.object({
  contactId: z.string().uuid(),
  expected: snapshotSchema,
  patch: snapshotSchema.partial().refine(value => Object.keys(value).length > 0, 'Change a contact detail before saving.'),
}).strict()

export function staffContactSnapshot(contact: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(STAFF_CONTACT_FIELDS.map(([key]) => [key, contact[key] ?? null]))
}

export function parseStaffContactEdit(value: unknown) {
  const parsed = staffContactEditSchema.safeParse(value)
  if (!parsed.success) throw new Error('Select a saved contact and change a valid contact detail before saving.')
  const patch = Object.fromEntries(Object.entries(parsed.data.patch).map(([key, value]) => [key, key === 'phone' ? formatPhoneForStorage(value ?? '') : value?.trim() || null]))
  for (const key of ['first_name', 'last_name']) {
    if (key in patch && !patch[key]) throw new Error('A saved contact must have a first and last name.')
  }
  if (patch.email && !z.string().email().safeParse(patch.email).success) throw new Error('Enter a valid email address.')
  return { ...parsed.data, patch }
}

const addSchema = z.object({
  operation: z.literal('add'), contactId: z.string().uuid(),
  patch: z.object({ ...fields, relationship_label: z.string().max(2000).nullable() }).partial().strict(),
}).strict()
const removeSchema = z.object({ operation: z.enum(['remove', 'restore']), contactId: z.string().uuid(), expected: snapshotSchema }).strict()

export function parseStaffContactOperation(value: unknown) {
  if (value && typeof value === 'object' && 'operation' in value) {
    if (value.operation === 'add') {
      const parsed = addSchema.safeParse(value)
      if (!parsed.success) throw new Error('Enter valid details for the new contact.')
      const { relationship_label, ...details } = parsed.data.patch
      const normalized = parseStaffContactEdit({ contactId: parsed.data.contactId, expected: staffContactSnapshot({}), patch: details })
      if (!normalized.patch.first_name || !normalized.patch.last_name) throw new Error('Enter a first and last name for the contact.')
      return { operation: 'add' as const, contactId: parsed.data.contactId, expected: {}, patch: { ...normalized.patch, relationship_label: relationship_label?.trim() || null } }
    }
    const parsed = removeSchema.safeParse(value)
    if (!parsed.success) throw new Error('Select a saved contact to remove.')
    return { ...parsed.data, patch: {} }
  }
  return { operation: 'edit' as const, ...parseStaffContactEdit(value) }
}
