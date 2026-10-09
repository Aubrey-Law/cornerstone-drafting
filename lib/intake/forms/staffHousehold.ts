import { z } from 'zod'
import { STAFF_CONTACT_FIELDS, staffContactSnapshot } from './staffContactEditing'
import { formatPhoneForStorage } from '@/lib/phone'
import { CITIZENSHIP_STATUS_OPTIONS } from '@aubrey-law/estate-fields/core'

export const HOUSEHOLD_EXTRA_FIELDS = [
  ['date_of_birth', 'Date of birth'], ['preferred_name', 'Preferred name'], ['prior_names', 'Prior names'],
  ['citizenship_status', 'Citizenship status'], ['child_relationship', 'Child relationship'], ['parentage', 'Parentage'],
] as const
export const HOUSEHOLD_FIELDS = [...STAFF_CONTACT_FIELDS, ...HOUSEHOLD_EXTRA_FIELDS] as const
export function staffHouseholdSnapshot(row: Record<string, unknown>) {
  return { ...staffContactSnapshot(row), ...Object.fromEntries(HOUSEHOLD_EXTRA_FIELDS.map(([key]) => [key, row[key] ?? null])) }
}
const snapshot = z.object(Object.fromEntries(HOUSEHOLD_FIELDS.map(([key]) => [key, z.string().max(2000).nullable()]))).strict()
const schema = z.object({ operation: z.enum(['add', 'edit', 'remove']), contactId: z.string().uuid(),
  expected: snapshot.nullable(), patch: snapshot.partial(),
}).strict()
export function isStaffHouseholdBlock(id: string) { return id === 'spouse_details' || id === 'children' }
export function parseStaffHouseholdEdit(value: unknown) {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error('Enter valid household contact details.')
  const result = parsed.data
  if (result.operation === 'add' ? result.expected !== null : result.expected === null) throw new Error('Reload the saved household contact before editing.')
  if (result.operation === 'remove' && Object.keys(result.patch).length) throw new Error('Removal cannot also change contact details.')
  const patch = Object.fromEntries(Object.entries(result.patch).map(([key, value]) => [key, key === 'phone' ? formatPhoneForStorage(value ?? '') : value?.trim() || null]))
  for (const key of ['first_name', 'last_name']) if ((key in patch || result.operation === 'add') && !patch[key]) throw new Error('Enter a first and last name.')
  if (patch.email && !z.string().email().safeParse(patch.email).success) throw new Error('Enter a valid email address.')
  if (patch.date_of_birth && (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date_of_birth) || !Number.isFinite(Date.parse(patch.date_of_birth)) || new Date(patch.date_of_birth).toISOString().slice(0, 10) !== patch.date_of_birth)) throw new Error('Enter a valid date of birth.')
  const options: Record<string, string[]> = { citizenship_status: CITIZENSHIP_STATUS_OPTIONS.map(option => option.value), child_relationship: ['biological','adopted','stepchild'], parentage: ['client','spouse','joint'] }
  for (const [key, choices] of Object.entries(options)) if (patch[key] && !choices.includes(patch[key])) throw new Error(`Select a valid ${key.replaceAll('_',' ')}.`)
  return { ...result, patch }
}
