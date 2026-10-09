// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminPinnedIntakeReview from '@/components/intake/AdminPinnedIntakeReview'
import { staffContactSnapshot } from '@/lib/intake/forms/staffContactEditing'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
const saveQuestion = vi.hoisted(() => vi.fn())
vi.mock('@/app/actions/adminIntakeQuestion', () => ({ saveAdminIntakeQuestion: saveQuestion }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('shows the saved compiled order, labels, answers and issues without edit capabilities', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const compiled = compileIntakeForm({ schemaVersion: 1, key: 'custom', title: 'Pinned title', sections: [
    { id: 'notes', title: 'Planning priorities', audience: 'client_and_staff', items: [{ kind: 'field', id: 'notes', fieldId: 'special_notes', requirement: 'required' }] },
    { id: 'identity', title: 'Identity', audience: 'client_and_staff', items: [{ kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'Given name' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }, 'staff')
  if (!compiled.success) throw new Error('Invalid fixture')
  render(<AdminPinnedIntakeReview form={compiled.form} data={{ first_name: 'Saved Ada' }} intakeId="intake" dirty />)
  expect(screen.getAllByRole('heading', { level: 4 }).map(node => node.textContent)).toEqual(['Planning priorities', 'Identity'])
  expect((screen.getByLabelText('Given name') as HTMLInputElement).value).toBe('Saved Ada')
  expect(screen.getByLabelText('Given name').matches(':disabled')).toBe(true)
  expect(screen.getByText("Answer anything else you'd like us to know?.")).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Save your edits')
  expect(fetch).not.toHaveBeenCalled()
})

function editableForm() {
  const result = compileIntakeForm({ schemaVersion: 1, key: 'college', title: 'College', sections: [
    { id: 'school', title: 'School', audience: 'client_and_staff', items: [{ kind: 'field', id: 'school', fieldId: 'college_school_name', labelOverride: 'University' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }, 'staff')
  if (!result.success) throw new Error('Invalid fixture')
  return result.form
}
const savedData = { status: 'draft', form_version_id: 'version', updated_at: 'stamp', college_prep_details: { school_name: 'Old university' } }
it('saves one answer with its snapshot and refreshes before ending editing', async () => {
  const onSaved = vi.fn().mockResolvedValue(undefined)
  const onEditingChange = vi.fn()
  render(<AdminPinnedIntakeReview form={editableForm()} data={savedData} intakeId="intake" dirty={false} onSaved={onSaved} onEditingChange={onEditingChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit University' }))
  expect(onEditingChange).toHaveBeenCalledWith(true)
  fireEvent.change(screen.getByLabelText('University'), { target: { value: 'New university' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(saveQuestion).toHaveBeenCalledWith({ intakeId: 'intake', expectedVersionId: 'version', expectedUpdatedAt: 'stamp', fieldId: 'college_school_name', value: 'New university' })
  await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(false))
})
it('retains the edited answer and shows save conflicts until cancelled', async () => {
  saveQuestion.mockRejectedValueOnce(new Error('The questionnaire changed.'))
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={editableForm()} data={savedData} intakeId="intake" dirty={false} onSaved={onSaved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit University' }))
  fireEvent.change(screen.getByLabelText('University'), { target: { value: 'Unsaved' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  expect((await screen.findByRole('alert')).textContent).toContain('changed')
  expect((screen.getByLabelText('University') as HTMLInputElement).value).toBe('Unsaved')
  expect(onSaved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel question edit' }))
  expect((screen.getByLabelText('University') as HTMLInputElement).value).toBe('Old university')
})
it.each([{ dirty: true }, { dirty: false, disabled: true }, { dirty: false, submitted: true }])('blocks question editing while dirty, busy or submitted: %s', props => {
  render(<AdminPinnedIntakeReview form={editableForm()} data={{ ...savedData, ...(props.submitted ? { status: 'submitted' } : {}) }} intakeId="intake" dirty={props.dirty} disabled={props.disabled} onSaved={vi.fn()} />)
  expect((screen.getByRole('button', { name: 'Edit University' }) as HTMLButtonElement).disabled).toBe(true)
})

function recipientForm() {
  const result = compileIntakeForm({ schemaVersion: 1, key: 'college', title: 'College', sections: [
    { id: 'recipients', title: 'Medical information', audience: 'client_and_staff', items: [{ kind: 'block', id: 'hipaa', blockId: 'college_hipaa_recipients', titleOverride: 'People to contact' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }, 'staff')
  if (!result.success) throw new Error('Invalid fixture')
  return result.form
}
const recipientData = { ...savedData, college_prep_details: { school_name: 'Preserve', hipaa_recipients: [
  { id: 'parent', name: 'Saved parent', relationship: 'Mother', phone: '', email: '', source: 'preserve metadata' },
] } }
it('displays nested saved recipients and saves edits and additions through the block controls', async () => {
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={recipientForm()} data={recipientData} intakeId="intake" dirty={false} onSaved={onSaved} />)
  expect((screen.getByDisplayValue('Saved parent') as HTMLInputElement).matches(':disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Edit People to contact' }))
  fireEvent.change(screen.getByDisplayValue('Saved parent'), { target: { value: 'Edited parent' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add someone who may receive information' }))
  const names = screen.getAllByLabelText('Name')
  fireEvent.change(names[1], { target: { value: 'New sibling' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(saveQuestion).toHaveBeenCalledWith({ intakeId: 'intake', expectedVersionId: 'version', expectedUpdatedAt: 'stamp', fieldId: 'college_hipaa_recipients', value: [
    { id: 'parent', name: 'Edited parent', relationship: 'Mother', phone: '', email: '' },
    { id: expect.any(String), name: 'New sibling', relationship: '', phone: '', email: '' },
  ] })
})
it('cancels removal without changing saved recipient answers', () => {
  render(<AdminPinnedIntakeReview form={recipientForm()} data={recipientData} intakeId="intake" dirty={false} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit People to contact' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove HIPAA recipient 1' }))
  expect(screen.queryByDisplayValue('Saved parent')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel question edit' }))
  expect(screen.getByDisplayValue('Saved parent')).toBeTruthy()
  expect(saveQuestion).not.toHaveBeenCalled()
})

function objectivesForm() {
  const result = compileIntakeForm({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
    { id: 'objectives', title: 'Goals', audience: 'client_and_staff', items: [{ kind: 'block', id: 'objectives', blockId: 'planning_objectives', titleOverride: 'Your priorities' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }, 'staff')
  if (!result.success) throw new Error('Invalid fixture')
  return result.form
}
it('shows serialized planning answers and sends only the three edited questions', async () => {
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={objectivesForm()} data={{ ...savedData, planning_objectives: JSON.stringify({ why_now: 'Saved reason', notes: 'Private staff notes', unknown: 'Keep' }) }} intakeId="intake" dirty={false} onSaved={onSaved} />)
  expect(screen.getByDisplayValue('Saved reason').matches(':disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Your priorities' }))
  fireEvent.change(screen.getByRole('textbox', { name: /Why are you planning now/ }), { target: { value: 'Updated reason' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(saveQuestion).toHaveBeenCalledWith({ intakeId: 'intake', expectedVersionId: 'version', expectedUpdatedAt: 'stamp', fieldId: 'planning_objectives', value: { why_choose_firm: '', why_now: 'Updated reason', make_things_easy: '' } })
})
it('cancels planning edits and restores the saved answer', () => {
  render(<AdminPinnedIntakeReview form={objectivesForm()} data={{ ...savedData, planning_objectives: { why_now: 'Saved reason' } }} intakeId="intake" dirty={false} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Your priorities' }))
  fireEvent.change(screen.getByRole('textbox', { name: /Why are you planning now/ }), { target: { value: 'Unsaved reason' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel question edit' }))
  expect(screen.getByDisplayValue('Saved reason')).toBeTruthy()
  expect(saveQuestion).not.toHaveBeenCalled()
})

function financialForm() {
  const result = compileIntakeForm({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
    { id: 'assets', title: 'Assets', audience: 'client_and_staff', items: [{ kind: 'block', id: 'assets', blockId: 'financial_assets', titleOverride: 'Your assets' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }, 'staff')
  if (!result.success) throw new Error('Invalid fixture')
  return result.form
}
const financialData = { ...savedData, financial_details: { asset_types: ['bank_accounts'], bank_accounts: { client_total: '500', spouse_total: '200', joint_total: '', metadata: 'preserve' }, personal_property: 'Untouched' } }
it('loads saved account totals into the details dialog and sends only changed groups', async () => {
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={financialForm()} data={financialData} intakeId="intake" dirty={false} onSaved={onSaved} />)
  expect(screen.getByRole('button', { name: 'Add details' }).matches(':disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Your assets' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add details' }))
  expect((screen.getByRole('textbox', { name: 'Client Total' }) as HTMLInputElement).value).toBe('500')
  fireEvent.change(screen.getByRole('textbox', { name: 'Client Total' }), { target: { value: '900' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(saveQuestion).toHaveBeenCalledWith({ intakeId: 'intake', expectedVersionId: 'version', expectedUpdatedAt: 'stamp', fieldId: 'financial_assets', value: { bank_accounts: { client_total: '900', spouse_total: '200', joint_total: '' } } })
})
it('cancels financial edits and restores original selection and totals', () => {
  render(<AdminPinnedIntakeReview form={financialForm()} data={financialData} intakeId="intake" dirty={false} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Your assets' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add details' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Client Total' }), { target: { value: '900' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Bank Accounts/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel question edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit Your assets' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add details' }))
  expect((screen.getByRole('textbox', { name: 'Client Total' }) as HTMLInputElement).value).toBe('500')
  expect(saveQuestion).not.toHaveBeenCalled()
})
it('shows a repair message instead of rendering malformed financial groups', () => {
  render(<AdminPinnedIntakeReview form={financialForm()} data={{ ...savedData, financial_details: { asset_types: ['real_estate'], real_estate: 'invalid list' } }} intakeId="intake" dirty={false} onSaved={vi.fn()} />)
  expect(screen.getByRole('alert').textContent).toContain('financial answers need review')
  expect(screen.queryByRole('button', { name: 'Edit Your assets' })).toBeNull()
})

function parentsForm() {
  const result = compileIntakeForm({ schemaVersion: 1, key: 'college', title: 'College', sections: [
    { id: 'parents', title: 'Parents', audience: 'client_and_staff', items: [{ kind: 'block', id: 'parents', blockId: 'college_parents', titleOverride: 'Trusted adults' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
  ] }, 'staff')
  if (!result.success) throw new Error('Invalid fixture')
  return result.form
}
const savedParent = { id: '20000000-0000-0000-0000-000000000001', first_name: 'Ada', last_name: 'Parent', email: 'parent@example.test', phone: '', relationship: 'Parent' }
const parentSnapshot = staffContactSnapshot(savedParent)
const parentData = { ...savedData, _additional_contacts: [{ ...savedParent, _staff_edit_snapshot: parentSnapshot }] }
it('edits one saved parent with a raw contact snapshot and only the changed fields', async () => {
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={parentsForm()} data={parentData} intakeId="intake" dirty={false} onSaved={onSaved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Trusted adults' }))
  expect((screen.getByRole('button', { name: 'Save answer' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'updated@example.test' } })
  expect((screen.getByRole('combobox', { name: 'Contact to edit' }) as HTMLSelectElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(saveQuestion).toHaveBeenCalledWith({ intakeId: 'intake', expectedVersionId: 'version', expectedUpdatedAt: 'stamp', fieldId: 'college_parents', value: { contactId: savedParent.id, expected: parentSnapshot, patch: { email: 'updated@example.test' } } })
})
it('cancels contact edits without writes and restores the original contact', () => {
  render(<AdminPinnedIntakeReview form={parentsForm()} data={parentData} intakeId="intake" dirty={false} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Trusted adults' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'unsaved@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel question edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit Trusted adults' }))
  expect((screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe('parent@example.test')
  expect(saveQuestion).not.toHaveBeenCalled()
})

it('adds a first contact to an empty questionnaire with one stable ID', async () => {
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={parentsForm()} data={{ ...savedData, _additional_contacts: [] }} intakeId="intake" dirty={false} onSaved={onSaved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Trusted adults' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: 'New' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: 'Parent' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Relationship' }), { target: { value: 'Parent' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save new contact' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(saveQuestion).toHaveBeenCalledWith(expect.objectContaining({ value: { operation: 'add', contactId: expect.any(String), patch: { first_name: 'New', last_name: 'Parent', relationship_label: 'Parent' } } }))
})
it('stages removal and supports keeping the contact without a write', () => {
  render(<AdminPinnedIntakeReview form={parentsForm()} data={parentData} intakeId="intake" dirty={false} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Trusted adults' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove from questionnaire' }))
  expect(screen.getByRole('button', { name: 'Save removal' })).toBeTruthy()
  expect(saveQuestion).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Keep contact' }))
  expect((screen.getByRole('button', { name: 'Save answer' }) as HTMLButtonElement).disabled).toBe(true)
})
it('shows appointment protection failures and retains the contact', async () => {
  saveQuestion.mockRejectedValueOnce(new Error('This contact holds an appointment.'))
  const onSaved = vi.fn()
  render(<AdminPinnedIntakeReview form={parentsForm()} data={parentData} intakeId="intake" dirty={false} onSaved={onSaved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Trusted adults' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove from questionnaire' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save removal' }))
  expect((await screen.findByRole('alert')).textContent).toContain('appointment')
  expect(onSaved).not.toHaveBeenCalled()
  expect(saveQuestion).toHaveBeenCalledWith(expect.objectContaining({ value: { operation: 'remove', contactId: savedParent.id, expected: parentSnapshot } }))
})
