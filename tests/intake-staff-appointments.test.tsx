// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import StaffAppointmentEditor from '@/components/intake/StaffAppointmentEditor'
import { parseStaffAppointmentEdit, type StaffAppointmentData } from '@/lib/intake/forms/staffAppointments'

const contact = '20000000-0000-0000-0000-000000000001'
const other = '20000000-0000-0000-0000-000000000002'
const row = { id: '40000000-0000-0000-0000-000000000001', contact_id: contact, role: 'poa', for_party: 'spouse', priority: 1, is_coagent: false }
const saved: StaffAppointmentData = { matterId: null, roles: [row], contacts: [{ id: contact, name: 'Current' }, { id: other, name: 'Other' }] }
afterEach(cleanup)
it('stages a single spouse slot and resets the pending edit when switching slots', () => {
  const update = vi.fn()
  render(<StaffAppointmentEditor block="spouse_fiduciaries" saved={saved} disabled={false} update={update} />)
  fireEvent.change(screen.getByLabelText('Appointment role'), { target: { value: 'poa' } })
  fireEvent.change(screen.getByLabelText('Appointed contact'), { target: { value: other } })
  expect(update).toHaveBeenLastCalledWith({ matterId: null, role: 'poa', party: 'spouse', priority: 1, coagent: false, contactId: other, expected: [row] })
  fireEvent.change(screen.getByLabelText('Appointment order'), { target: { value: '2' } })
  expect(update).toHaveBeenLastCalledWith(null)
  fireEvent.click(screen.getByLabelText('Co-agent for this appointment'))
  fireEvent.change(screen.getByLabelText('Appointed contact'), { target: { value: contact } })
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ priority: 2, coagent: true, expected: [] }))
})
it('stages removal without deleting the person and blocks ambiguous slots', () => {
  const update = vi.fn()
  const view = render(<StaffAppointmentEditor block="college_agents" saved={{ ...saved, roles: [{ ...row, for_party: 'client' }] }} disabled={false} update={update} />)
  fireEvent.change(screen.getByLabelText('Appointed contact'), { target: { value: '' } })
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ contactId: null, expected: [{ ...row, for_party: 'client' }] }))
  view.rerender(<StaffAppointmentEditor block="college_agents" saved={{ ...saved, roles: [row, row].map(r => ({ ...r, for_party: 'client' })) }} disabled={false} update={update} />)
  expect(screen.getByRole('alert').textContent).toContain('Multiple people')
  expect(screen.queryByLabelText('Appointed contact')).toBeNull()
})
const edit = { matterId: null, role: 'poa', party: 'spouse', priority: 1, coagent: false, contactId: other, expected: [row] }
it('validates the exact block and slot and preserves snapshot identity', () => {
  expect(parseStaffAppointmentEdit('spouse_fiduciaries', edit)).toEqual(edit)
})
it.each([
  { priority: 0 }, { priority: 11 }, { party: 'client' }, { role: 'trustee' },
  { contactId: 'bad' }, { expected: [row, row] }, { unexpected: true }, { expected: [{ ...row, priority: 2 }] },
])('rejects invalid or cross-slot appointment requests %#', patch => {
  expect(() => parseStaffAppointmentEdit('spouse_fiduciaries', { ...edit, ...patch })).toThrow()
})
