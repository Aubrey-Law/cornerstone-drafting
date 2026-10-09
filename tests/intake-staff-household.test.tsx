// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import StaffHouseholdEditor from '@/components/intake/StaffHouseholdEditor'
import StaffAdditionalContactEditor from '@/components/intake/StaffAdditionalContactEditor'
import { parseStaffHouseholdEdit, staffHouseholdSnapshot } from '@/lib/intake/forms/staffHousehold'
import { parseStaffContactOperation, staffContactSnapshot } from '@/lib/intake/forms/staffContactEditing'
import { mergeExcludedGuardians, parseStaffAppointmentChoice } from '@/lib/intake/forms/staffAppointments'
const id = '21000000-0000-0000-0000-000000000001'
const person = { first_name: 'Test', last_name: 'Child', date_of_birth: '2015-01-01', parentage: 'joint' }
const expected = staffHouseholdSnapshot(person) as Record<string, string | null>
afterEach(cleanup)
it('stages an existing household change with its exact raw snapshot', () => {
  const update = vi.fn()
  render(<StaffHouseholdEditor block="children" contacts={[{ id, kind: 'child', expected }]} disabled={false} update={update} />)
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Updated' } })
  expect(update).toHaveBeenLastCalledWith({ operation: 'edit', contactId: id, expected, patch: { first_name: 'Updated' } })
  expect((screen.getByRole('button', { name: 'Remove from household' }) as HTMLButtonElement).disabled).toBe(true)
})
it('stages removal without mutating data until the parent saves', () => {
  const update = vi.fn()
  render(<StaffHouseholdEditor block="children" contacts={[{ id, kind: 'child', expected }]} disabled={false} update={update} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove from household' }))
  expect(update).toHaveBeenLastCalledWith({ operation: 'remove', contactId: id, expected, patch: {} })
  expect(screen.getByRole('status').textContent).toContain('retained')
})
it('restores a retained contact using the same identity and snapshot', () => {
  const update = vi.fn()
  const snapshot = staffContactSnapshot(person)
  render(<StaffAdditionalContactEditor contacts={[]} removed={[{ id, _staff_edit_snapshot: snapshot }]} disabled={false} update={update} />)
  fireEvent.change(screen.getByLabelText('Restore removed contact'), { target: { value: id } })
  expect(parseStaffContactOperation(update.mock.calls.at(-1)?.[0])).toMatchObject({ operation: 'restore', contactId: id, expected: snapshot })
  expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull()
})
it('accepts household changes and rejects malformed dates, empty names, unknown fields, and invalid parentage', () => {
  const base = { operation: 'edit', contactId: id, expected }
  expect(parseStaffHouseholdEdit({ ...base, patch: { phone: '617-555-0100' } }).patch.phone).toBeTruthy()
  for (const patch of [{ date_of_birth: '2026-02-30' }, { first_name: '' }, { source: 'override' }, { parentage: 'both' }]) expect(() => parseStaffHouseholdEdit({ ...base, patch })).toThrow()
  expect(() => parseStaffHouseholdEdit({ operation: 'add', contactId: id, expected: null, patch: { first_name: 'Incomplete' } })).toThrow()
})
it('preserves excluded-guardian metadata and other groups while validating review choices', () => {
  const old = { first_name: 'Keep', last_name: 'Person', metadata: { keep: true } }
  expect(mergeExcludedGuardians({ excludedNames: ['Keep Person', 'New Person'] }, { children: ['preserve'], fid_excluded_guardian: [old] })).toMatchObject({
    excluded_guardian: 'Keep Person; New Person', fiduciary_entries: { children: ['preserve'], fid_excluded_guardian: [old, { first_name: 'New', last_name: 'Person' }] },
  })
  expect(parseStaffAppointmentChoice({ reviewChoice: 'discuss_with_attorney' })).toBe('discuss_with_attorney')
  expect(() => parseStaffAppointmentChoice({ reviewChoice: 'other' })).toThrow()
})
