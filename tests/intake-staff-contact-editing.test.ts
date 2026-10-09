import { expect, it } from 'vitest'
import { parseStaffContactEdit, parseStaffContactOperation, staffContactSnapshot } from '@/lib/intake/forms/staffContactEditing'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'
const contact = { id: '20000000-0000-0000-0000-000000000001', first_name: 'Ada', last_name: 'Parent', source: 'client_intake_additional', email: 'old@example.test', address_line2: 'Suite 2' }
const expected = staffContactSnapshot(contact)
it('attaches exact raw edit snapshots only for staff hydration', () => {
  const staff = applyContactIntakeData({}, [contact], true)._additional_contacts as Record<string, unknown>[]
  expect(staff[0]._staff_edit_snapshot).toEqual(expected)
  const client = applyContactIntakeData({}, [contact])._additional_contacts as Record<string, unknown>[]
  expect(client[0]).not.toHaveProperty('_staff_edit_snapshot')
})
it('normalizes only changed fields and retains the raw expected snapshot', () => {
  expect(parseStaffContactEdit({ contactId: contact.id, expected, patch: { email: ' new@example.test ', middle_name: '' } })).toEqual({ contactId: contact.id, expected, patch: { email: 'new@example.test', middle_name: null } })
})
it.each([{}, { id: 'other' }, { first_name: '' }, { last_name: null }, { email: 'invalid' }, { source: 'other' }, { city: 123 }, { phone: 'x'.repeat(2001) }])('rejects invalid contact changes %#', patch => {
  expect(() => parseStaffContactEdit({ contactId: contact.id, expected, patch })).toThrow()
})

it('normalizes new contact fields and accepts a snapshot-only removal', () => {
  expect(parseStaffContactOperation({ operation: 'add', contactId: contact.id, patch: { first_name: ' New ', last_name: 'Person', relationship_label: ' Parent ' } })).toMatchObject({ operation: 'add', expected: {}, patch: { first_name: 'New', last_name: 'Person', relationship_label: 'Parent' } })
  expect(parseStaffContactOperation({ operation: 'remove', contactId: contact.id, expected })).toEqual({ operation: 'remove', contactId: contact.id, expected, patch: {} })
})
it.each([
  { operation: 'add', contactId: contact.id, patch: { first_name: 'Missing surname' } },
  { operation: 'add', contactId: contact.id, patch: { first_name: 'New', last_name: 'Person', source: 'override' } },
  { operation: 'remove', contactId: contact.id, expected, patch: { email: 'override' } },
  { operation: 'delete', contactId: contact.id, expected },
])('rejects invalid membership operations %#', value => {
  expect(() => parseStaffContactOperation(value)).toThrow()
})
it('does not resurrect removed contacts from historical snapshots during unpacking', () => {
  const legacy = { fiduciary_entries: { additional_contacts: [{ id: contact.id, first_name: 'Old' }] } }
  const hydrated = applyContactIntakeData(legacy, [{ ...contact, source: 'client_intake_additional_removed' }])
  expect(unpackInitialIntakeData(hydrated)._additional_contacts).toEqual([])
  expect(unpackInitialIntakeData(legacy)._additional_contacts).toEqual([{ id: contact.id, first_name: 'Old' }])
})
it('prefers live additional contacts over older embedded answers', () => {
  const hydrated = applyContactIntakeData({ fiduciary_entries: { additional_contacts: [{ first_name: 'Old' }] } }, [contact])
  expect((unpackInitialIntakeData(hydrated)._additional_contacts as { first_name: string }[])[0].first_name).toBe('Ada')
})
