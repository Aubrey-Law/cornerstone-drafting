// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LeadFieldsRail } from '@/components/leads/LeadFieldsRail'
import { LeadIntakeCard } from '@/app/admin/leads/[id]/LeadIntakeCard'
import type { LeadEditableField } from '@/lib/leads/details'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'
vi.mock('@/app/admin/components/MatterAssistantQuickPrompts', () => ({ MatterAssistantQuickPrompts: () => null }))
vi.mock('@/components/leads/LeadEstateTaxCard', () => ({ LeadEstateTaxCard: () => null }))
afterEach(cleanup)
const lead = { id: 'l1', first_name: 'Jane', last_name: 'Doe', email: 'old@example.com', lead_status: 'lead', practice_area: 'EP' } as LeadDetailRecord
function Harness({ save }: { save: (field: LeadEditableField, value: unknown) => Promise<void> }) {
  const [field, setField] = useState<LeadEditableField | null>('email')
  return <LeadFieldsRail lead={lead} spouse={null} activeField={field} onActiveFieldChange={setField} onSaveField={save} onRemoveSpouse={() => {}} />
}
it('retains a failed draft, retries it explicitly, and closes after success', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(undefined)
  render(<Harness save={save} />)
  const input = screen.getByRole('textbox', { name: 'Email' })
  fireEvent.change(input, { target: { value: 'new@example.com' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByRole('button', { name: 'Retry' })
  expect((screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe('new@example.com')
  fireEvent.blur(input)
  expect(save).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull())
  expect(save).toHaveBeenLastCalledWith('email', 'new@example.com')
})
it('lets a failed edit be cancelled without another write', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Network unavailable'))
  render(<Harness save={save} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@example.com' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Edit Email' }).textContent).toBe('old@example.com')
  expect(save).toHaveBeenCalledTimes(1)
})
it('opens a collapsed group for a programmatic field edit', async () => {
  render(<LeadFieldsRail lead={lead} spouse={null} activeField="fee" onActiveFieldChange={() => {}} onSaveField={vi.fn()} onRemoveSpouse={() => {}} />)
  expect(screen.getByRole('button', { name: 'Qualification' }).getAttribute('aria-expanded')).toBe('true')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: 'Quoted fee' })))
})
it('keeps configured questionnaires compact and opens incomplete sections', () => {
  const onOpenSection = vi.fn()
  render(<LeadIntakeCard intake={{ intake_track: 'estate' }} intakeUrl="https://example.com/intake" onOpen={() => {}} onCopy={() => {}} onTrackChange={() => {}} onRotate={() => {}} onOpenSection={onOpenSection} />)
  expect(screen.queryByRole('button', { name: 'College Preparation Plan' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Change' }))
  expect(screen.getByRole('button', { name: 'College Preparation Plan' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open Contact section' }))
  expect(onOpenSection).toHaveBeenCalledWith('contact')
  expect(screen.queryByRole('menuitem', { name: 'Replace link' })).toBeNull()
})
