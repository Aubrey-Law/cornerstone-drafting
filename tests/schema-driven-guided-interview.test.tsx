// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SchemaDrivenGuidedInterview from '@/components/intake/SchemaDrivenGuidedInterview'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { compileBundledIntakeForm } from '@/lib/intake/forms/definitions'
import type { CompiledIntakeSectionsProps } from '@/components/intake/formEngine/CompiledIntakeSections'

const mocks = vi.hoisted(() => ({
  flush: vi.fn(async () => true), track: vi.fn(), debounce: vi.fn(), refresh: vi.fn(),
  spouse: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined), children: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  fiduciaries: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined), additional: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  session: vi.fn(async () => ({ data: { session: { access_token: 'session-1' } } })),
  error: vi.fn(), renderReview: false,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: mocks.session } } }))
vi.mock('@/hooks/useAutoSave', () => ({ useAutoSave: () => ({ status: 'saved', flush: mocks.flush, trackForFlush: mocks.track, debouncedSave: mocks.debounce }) }))
vi.mock('@/hooks/useContacts', () => ({ useContacts: () => ({ saveSpouse: mocks.spouse, saveChildren: mocks.children, saveFiduciaries: mocks.fiduciaries, saveAdditionalContacts: mocks.additional }) }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('@/components/intake/LegacyGuidedInterview', () => ({ ReviewModal: ({ onSubmit, submitting, reviewContent }: { onSubmit: () => void; submitting: boolean; reviewContent?: React.ReactNode }) => <div>{mocks.renderReview ? reviewContent : null}<button disabled={submitting} onClick={onSubmit}>Submit questionnaire</button></div> }))
// Domain controls are covered by the compiled renderer suites; this boundary
// exposes canonical writes while exercising the real interview orchestration.
vi.mock('@/components/intake/formEngine/CompiledIntakeSections', () => ({
  CompiledIntakeSections: (props: CompiledIntakeSectionsProps) => <div>
    {props.evaluation.activeSections.map((section) => <div key={section.id}>
      <button onClick={() => props.onToggle(section.id)}>{section.title}</button>
      {props.openId === section.id && section.items.map(({ item }) => item.kind === 'field'
        ? <input key={item.id} aria-label={item.label} disabled={props.mode === 'attorney'} value={String(props.data[item.fieldId === 'client_first_name' ? 'first_name' : item.fieldId === 'client_last_name' ? 'last_name' : item.fieldId === 'client_email' ? 'email' : item.fieldId === 'client_phone' ? 'phone' : item.fieldId] ?? '')} onChange={(e) => props.update(item.fieldId === 'client_first_name' ? 'first_name' : item.fieldId, e.target.value)} />
        : item.kind !== 'block' ? null : item.blockId === 'client_fiduciaries' || item.blockId === 'college_agents' || item.blockId === 'spouse_fiduciaries'
          ? <button key={item.id} onClick={() => props.update(item.blockId === 'spouse_fiduciaries' ? '_fid_poa_spouse' : '_fid_poa_client', [])}>Remove final nominee</button>
          : <button key={item.id} disabled={props.mode === 'attorney'} onClick={() => props.update(item.blockId === 'children' ? '_children' : '_additional_contacts', [{ first_name: item.blockId === 'children' && props.data._children ? 'Updated' : 'New', last_name: 'Person' }])}>Edit {item.blockId}</button>)}
    </div>)}
  </div>,
}))

const completeContact = { first_name: 'Jane', last_name: 'Example', email: 'jane@example.com', phone: '(617) 555-0100' }
function form() {
  const result = compileIntakeForm({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
    { id: 'personal', title: 'Personal', audience: 'client_and_staff', items: ['client_first_name', 'client_last_name', 'client_email', 'client_phone'].map((fieldId) => ({ kind: 'field', id: fieldId, fieldId })) },
    { id: 'children', title: 'Children', audience: 'client_and_staff', items: [{ kind: 'block', id: 'children-list', blockId: 'children' }] },
    { id: 'people', title: 'People', audience: 'client_and_staff', items: [{ kind: 'block', id: 'people-list', blockId: 'additional_contacts' }] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review-item', blockId: 'review_submit' }] },
  ] }, 'client')
  if (!result.success) throw new Error(JSON.stringify(result.errors))
  return result.form
}
const submitFetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))
function mount(initialData: Record<string, unknown> = completeContact, extra: Partial<React.ComponentProps<typeof SchemaDrivenGuidedInterview>> = {}) {
  return render(<SchemaDrivenGuidedInterview intakeId="intake-1" initialData={initialData} compiledForm={form()} {...extra} />)
}
async function submit() {
  fireEvent.click(screen.getByRole('button', { name: /Review questionnaire/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
  await waitFor(() => expect(mocks.flush).toHaveBeenCalled())
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.flush.mockResolvedValue(true)
  mocks.children.mockResolvedValue(undefined)
  mocks.additional.mockResolvedValue(undefined)
  mocks.fiduciaries.mockResolvedValue(undefined)
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'session-1' } } })
  vi.stubGlobal('fetch', submitFetch)
})
afterEach(() => {
  mocks.renderReview = false
  cleanup()
  vi.unstubAllGlobals()
})

describe('compiled interview workflow', () => {
  it.each([false, true])('autosaves current household and appointment answers over embedded snapshots (empty: %s)', empty => {
    const current = empty ? [] : [{ contact_id: 'current-id', first_name: 'Current', last_name: 'Person', priority: 2 }]
    mount({ ...completeContact, _children: current, _fid_poa_spouse: current,
      fiduciary_entries: { children: [{ first_name: 'Stale child' }], fid_poa_spouse: [{ first_name: 'Stale nominee', priority: 1 }] },
    })
    expect(mocks.debounce).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Personal' })[0])
    fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: 'Janet' } })
    const body = mocks.debounce.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>
    expect(body._children).toEqual(current)
    expect(body._fid_poa_spouse).toEqual(current)
    expect(JSON.stringify(body)).not.toContain('Stale')
  })

  it('tracks canonical edits and saves a dirty contact block on leave', async () => {
    mount()
    fireEvent.click(screen.getAllByRole('button', { name: 'Personal' })[0])
    fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: 'Janet' } })
    expect(mocks.track).toHaveBeenLastCalledWith(expect.objectContaining({ first_name: 'Janet' }))
    expect(mocks.debounce).toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Children' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Personal' })[0])
    await waitFor(() => expect(mocks.children).toHaveBeenCalledWith([{ first_name: 'New', last_name: 'Person' }]))
  })

  it.each([undefined, 'public-1'])('submits through the correct authentication path (%s)', async (publicIntakeToken) => {
    mount(completeContact, { publicIntakeToken })
    await submit()
    await waitFor(() => expect(submitFetch).toHaveBeenCalled())
    const init = submitFetch.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual(publicIntakeToken
      ? { 'Content-Type': 'application/json', 'X-Intake-Token': publicIntakeToken }
      : { 'Content-Type': 'application/json', Authorization: 'Bearer session-1' })
    expect(JSON.parse(String(init.body))).toEqual({ existingId: 'intake-1', status: 'submitted' })
    if (publicIntakeToken) expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('does not submit when autosave flush fails', async () => {
    mocks.flush.mockResolvedValue(false)
    mount()
    await submit()
    expect(submitFetch).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('latest changes'))
  })

  it('persists every active dirty block even when it is no longer open', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    // A failed background leave must remain dirty and be retried before submit.
    mocks.children.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getAllByRole('button', { name: 'People' })[0])
    await waitFor(() => expect(mocks.children).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Edit additional_contacts' }))
    await submit()
    await waitFor(() => expect(submitFetch).toHaveBeenCalled())
    expect(mocks.children).toHaveBeenCalledTimes(2)
    expect(mocks.additional).toHaveBeenCalledTimes(1)
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(mocks.children.mock.invocationCallOrder[1])
    expect(mocks.additional.mock.invocationCallOrder[0]).toBeLessThan(submitFetch.mock.invocationCallOrder[0])
  })

  it('does not submit when a contact save fails', async () => {
    mocks.children.mockRejectedValue(new Error('offline'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    await submit()
    await waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(submitFetch).not.toHaveBeenCalled()
  })

  it.each(['client_fiduciaries', 'spouse_fiduciaries', 'college_agents'] as const)('keeps final nominee removal dirty after a failed %s clear and retries before submit', async (blockId) => {
    const compiled = compileIntakeForm({ schemaVersion: 1, key: blockId === 'college_agents' ? 'college_prep' : 'estate', title: 'Intake', sections: [
      { id: 'fiduciaries', title: 'Fiduciaries', audience: 'client_and_staff', items: [{ kind: 'block', id: 'roles', blockId }] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    const party = blockId === 'spouse_fiduciaries' ? 'spouse' : 'client'
    mount({ ...completeContact, [`_fid_poa_${party}`]: [{ first_name: 'Pat', last_name: 'Example', priority: 1 }], [`_fid_hcp_${party}`]: [] }, { compiledForm: compiled.form })
    fireEvent.click(screen.getByRole('button', { name: 'Remove final nominee' }))
    mocks.fiduciaries.mockRejectedValueOnce(new Error('failed clear'))
    await submit()
    await waitFor(() => expect(mocks.fiduciaries).toHaveBeenCalledWith([], 'poa', party))
    expect(submitFetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
    await waitFor(() => expect(submitFetch).toHaveBeenCalled())
    expect(mocks.fiduciaries).toHaveBeenCalledTimes(2)
    expect(mocks.fiduciaries).toHaveBeenLastCalledWith([], 'poa', party)
  })

  it('retains edited hidden block answers and skips their explicit persistence', async () => {
    const compiled = compileIntakeForm({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
      { id: 'family', title: 'Family', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'has-children', fieldId: 'has_children' },
        { kind: 'block', id: 'children', blockId: 'children', condition: { op: 'equals', fieldId: 'has_children', value: true } },
      ] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    mount({ ...completeContact, has_children: true }, { compiledForm: compiled.form })
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    fireEvent.change(screen.getByLabelText(/children/i), { target: { value: 'hidden' } })
    expect(screen.queryByRole('button', { name: 'Edit children' })).toBeNull()
    await submit()
    await waitFor(() => expect(submitFetch).toHaveBeenCalled())
    expect(mocks.children).not.toHaveBeenCalled()
    expect(mocks.track).toHaveBeenLastCalledWith(expect.objectContaining({ _children: [{ first_name: 'New', last_name: 'Person' }] }))
  })

  it('reevaluates latest answers after flush and blocks only submission errors', async () => {
    mount()
    mocks.flush.mockImplementationOnce(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Personal' })[0])
      await waitFor(() => expect(screen.getByLabelText(/First name/i)).toBeDefined())
      fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: '' } })
      return true
    })
    await submit()
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('required items'), expect.anything()))
    expect(submitFetch).not.toHaveBeenCalled()
  })

  it('locks submitted client answers without emitting initialization writes', () => {
    mount(completeContact, { submitted: true })
    expect(screen.getByText(/Thank you/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Review questionnaire/ })).toBeNull()
    expect(mocks.track).not.toHaveBeenCalled()
    expect(mocks.debounce).not.toHaveBeenCalled()
  })

  it('waits for an in-flight contact save and persists a newer edit before submit', async () => {
    let finish!: () => void
    mocks.children.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'People' })[0])
    await waitFor(() => expect(mocks.children).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getAllByRole('button', { name: 'Children' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'People' })[0])
    await submit()
    expect(submitFetch).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(submitFetch).toHaveBeenCalled())
    expect(mocks.children).toHaveBeenCalledTimes(2)
    expect(mocks.children).toHaveBeenLastCalledWith([{ first_name: 'Updated', last_name: 'Person' }])
  })

  it('flushes valid edits made while contact persistence is pending before submitting', async () => {
    let finish!: () => void
    mocks.children.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit children' }))
    await submit()
    await waitFor(() => expect(mocks.children).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: 'Personal' })[0])
    fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: 'Janet' } })
    finish()
    await waitFor(() => expect(submitFetch).toHaveBeenCalled())
    expect(mocks.flush).toHaveBeenCalledTimes(2)
  })

  it('preserves attorney-only plan selection and read-only client answers', async () => {
    const save = vi.fn(async () => undefined)
    mount(completeContact, { mode: 'attorney', onAttorneySave: save })
    fireEvent.click(screen.getByRole('button', { name: /Joint Revocable Living Trust/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ plan_type: 'joint_rlt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }))
    expect((screen.getByLabelText(/First name/i) as HTMLInputElement).disabled).toBe(true)
    expect(mocks.track).not.toHaveBeenCalled()
    expect(mocks.debounce).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Review questionnaire/ })).toBeNull()
  })

  it('receives only audience-filtered client sections', () => {
    const compiled = compileBundledIntakeForm('estate', 'client')
    expect(compiled.success).toBe(true)
    if (!compiled.success) return
    expect(compiled.form.sections.every((section) => section.audience === 'client_and_staff')).toBe(true)
    expect(JSON.stringify(compiled.form)).not.toContain('attorney_')
  })
})

describe('compiled questionnaire review', () => {
  it('reviews custom section order, labels and requirements and edits the actual section', () => {
    const compiled = compileIntakeForm({ schemaVersion: 1, key: 'custom', title: 'Custom', sections: [
      { id: 'custom_notes', title: 'Your priorities', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'notes', fieldId: 'special_notes', labelOverride: 'Planning notes', requirement: 'required' },
      ] },
      { id: 'custom_identity', title: 'Your identity', audience: 'client_and_staff', items: [
        { kind: 'field', id: 'first', fieldId: 'client_first_name', labelOverride: 'Given name' },
      ] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    mocks.renderReview = true
    render(<SchemaDrivenGuidedInterview initialData={completeContact} intakeId="intake-1" compiledForm={compiled.form} />)
    fireEvent.click(screen.getByRole('button', { name: /Review questionnaire/ }))
    const review = within(screen.getByRole('region', { name: 'Current form review' }))
    expect(review.getAllByRole('heading').map(node => node.textContent)).toEqual(['Your priorities', 'Your identity'])
    expect(review.getByLabelText('Given name').matches(':disabled')).toBe(true)
    expect((review.getByLabelText('Given name') as HTMLInputElement).value).toBe('Jane')
    expect(review.getByText("Answer anything else you'd like us to know?.")).toBeTruthy()
    expect(review.queryByText('Personal Information')).toBeNull()
    fireEvent.click(review.getByRole('button', { name: 'Edit Your identity' }))
    expect(screen.queryByRole('region', { name: 'Current form review' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Given name' })).toBeTruthy()
    expect(mocks.debounce).not.toHaveBeenCalled()
    expect(submitFetch).not.toHaveBeenCalled()
  })
})


it.each([
  ['college_prep', 'custom_student_form', true],
  ['estate', 'college_prep', false],
] as const)('uses the intake track %s independently of the template key %s', (track, key, college) => {
  render(<SchemaDrivenGuidedInterview initialData={{ ...completeContact, intake_track: track }} intakeId="intake-1"
    compiledForm={{ ...form(), key, title: 'Published form title', description: 'Published form instructions' }} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Published form title')
  expect(screen.getByText('Published form instructions')).toBeTruthy()
  expect(Boolean(screen.queryByText(/Every document here is voluntary/))).toBe(college)
})
