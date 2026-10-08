// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SchemaDrivenGuidedInterview from '@/components/intake/SchemaDrivenGuidedInterview'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { POST } from '@/app/api/intake/contacts/route'
import { POST as saveIntake } from '@/app/api/intake/route'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'
import { saveAdditionalContacts } from '@/lib/contacts/saveAdditionalContacts'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ contacts: [] as Row[], roles: [] as Row[], joins: [] as Row[], mutations: [] as string[], failOnce: false, failReadOnce: false, strictFailOnce: false, attachFailOnce: false, submits: 0, requests: [] as Request[], error: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }) } } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ ...getAdminClient(), auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts: vi.fn() }))
vi.mock('@/lib/syncLeadFromIntake', () => ({ intakePayloadTouchesLead: () => false, syncLeadFromIntake: vi.fn() }))
vi.mock('@/lib/intakeSeed', () => ({ seedDesignSheetAndJobs: vi.fn(async () => {}) }))
// Submission eligibility is covered separately; keep this fixture focused on
// real request parsing, identity hydration, contact writes and materialization.
vi.mock('@/lib/intakeSections', async (original) => ({ ...await original<object>(), getSubmissionErrors: () => [] }))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken: async () => ({ id: 'intake', status: 'draft' }) }))
vi.mock('@/lib/contacts/attachContactToMatter', () => ({ attachContactToMatter: async (_admin: unknown, matterId: string, contactId: string) => { if (state.attachFailOnce) { state.attachFailOnce = false; throw new Error('Membership save failed') } if (!state.joins.some((row) => row.matter_id === matterId && row.contact_id === contactId)) state.joins.push({ matter_id: matterId, contact_id: contactId }) }, matterIdForIntake: async () => 'matter' }))
vi.mock('sonner', () => ({ toast: { error: state.error } }))
vi.mock('@/components/intake/LegacyGuidedInterview', () => ({ ReviewModal: ({ onSubmit, submitting }: { onSubmit: () => void; submitting: boolean }) => <button disabled={submitting} onClick={onSubmit}>Submit questionnaire</button> }))
// Only the database transport is replaced. It models scoped queries and the
// contact_roles ON DELETE CASCADE that made the old replacement unsafe.
vi.mock('@/lib/supabaseAdmin', () => ({ ADMIN_EMAIL: 'staff@example.com', getAdminClient: () => ({ from: (table: string) => {
  let verb = 'select'
  let payload: Row | Row[] = {}
  const filters: Array<(row: Row) => boolean> = []
  let result: { data: Row[]; error: { message: string } | null } | undefined
  const execute = () => {
    if (result) return result
    if (table === 'client_intake') return { data: [{ id: 'intake', status: 'draft' }], error: null }
    if (table === 'intake_invite_audit') return { data: [], error: null }
    if (table === 'contacts' && verb === 'select' && state.failReadOnce) {
      state.failReadOnce = false
      return result = { data: [], error: { message: 'Temporary contact read failure' } }
    }
    const rows = table === 'contacts' ? state.contacts : table === 'matter_contacts' ? state.joins : table === 'matters' ? [{ id: 'matter', client_intake_id: 'intake' }] : state.roles
    const matching = rows.filter((row) => filters.every((filter) => filter(row)))
    if (verb !== 'select') {
      state.mutations.push(`${table}:${verb}`)
      if (state.failOnce) { state.failOnce = false; return result = { data: [], error: { message: 'Temporary database failure' } } }
    }
    let returned = matching
    if (verb === 'delete') {
      if (table === 'contacts') {
        state.contacts = rows.filter((row) => !matching.includes(row))
        state.roles = state.roles.filter((role) => !matching.some((row) => row.id === role.contact_id))
      } else state.roles = rows.filter((row) => !matching.includes(row))
    }
    if (verb === 'update') matching.forEach((row) => Object.assign(row, payload))
    if (verb === 'insert') {
      const incoming = Array.isArray(payload) ? payload : [payload]
      if (incoming.some((row) => row.id && rows.some((existing) => existing.id === row.id))) return result = { data: [], error: { message: 'duplicate key' } }
      returned = incoming.map((row) => ({ ...row, id: row.id ?? `created-${rows.length}` }))
      rows.push(...returned)
    }
    return result = { data: returned, error: null }
  }
  const chain = {
    select: () => chain,
    update: (value: Row) => { verb = 'update'; payload = value; return chain },
    insert: (value: Row | Row[]) => { verb = 'insert'; payload = value; return chain },
    delete: () => { verb = 'delete'; return chain },
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return chain },
    or: () => chain,
    maybeSingle: async () => ({ ...execute(), data: execute().data[0] ?? null }),
    single: async () => ({ ...execute(), data: execute().data[0] ?? null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
  }
  return chain
} }) }))

const parentId = '11111111-1111-4111-8111-111111111111'
const foreignId = '22222222-2222-4222-8222-222222222222'
const parent = { id: parentId, contact_id: parentId, first_name: 'Pat', last_name: 'Example', phone: '(617) 555-0101', priority: 1 }
const roles = ['poa', 'hcp', 'trustee', 'personal_rep', 'guardian']
function request(contacts: Row[], publicToken?: string) {
  return new Request('http://localhost/api/intake/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(publicToken ? { 'X-Intake-Token': publicToken } : { Authorization: 'Bearer session' }) }, body: JSON.stringify({ action: 'save_additional_contacts', intakeId: 'intake', contacts }) })
}
function autosave(body: Row, publicToken?: string) {
  return saveIntake(new Request('http://localhost/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(publicToken ? { 'X-Intake-Token': publicToken } : { Authorization: 'Bearer session' }) }, body: JSON.stringify({ existingId: 'intake', ...body }) }))
}
beforeEach(() => {
  state.contacts = [{ ...parent, relationship_type: 'other', client_intake_id: 'intake', source: 'client_intake_additional' }, { id: foreignId, first_name: 'Other', last_name: 'Person', client_intake_id: 'other-intake', source: 'client_intake_additional' }]
  state.roles = roles.map((role) => ({ contact_id: parentId, matter_id: 'matter', is_coagent: false, client_intake_id: 'intake', role, for_party: 'client', priority: 1 }))
  state.joins = [{ matter_id: 'matter', contact_id: parentId }]
  state.mutations = []; state.requests = []; state.failOnce = false; state.failReadOnce = false; state.strictFailOnce = false; state.attachFailOnce = false; state.submits = 0; state.error.mockClear()
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url === '/api/intake/contacts') {
      const req = new Request(`http://localhost${url}`, init)
      state.requests.push(req.clone())
      state.failReadOnce = state.strictFailOnce
      state.strictFailOnce = false
      return POST(req)
    }
    const body = JSON.parse(String(init.body))
    const response = await saveIntake(new Request(`http://localhost${url}`, init))
    if (body.status === 'submitted' && response.ok) state.submits++
    return response
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe.each([undefined, 'invite'])('contact identity through intake save (%s)', (publicToken) => {
  it.each(['first_name', 'last_name'])('retains a temporarily empty %s through autosave, failed section leave and retry', async (field) => {
    const incomplete = { ...parent, [field]: '' }
    expect((await autosave({ additional_contacts: [incomplete] }, publicToken)).status).toBe(200)
    expect(state.contacts.find((row) => row.id === parentId)?.first_name).toBe('Pat')
    expect(state.roles).toHaveLength(5)
    expect((await POST(request([incomplete], publicToken))).status).toBe(400)
    expect(state.mutations).toEqual([])
    expect((await POST(request([{ ...parent, [field]: 'Corrected' }], publicToken))).status).toBe(200)
    expect(state.roles).toHaveLength(5)
    expect(state.contacts.find((row) => row.id === parentId)?.[field]).toBe('Corrected')
    expect((await POST(request([], publicToken))).status).toBe(200)
    expect(state.contacts.some((row) => row.id === parentId)).toBe(false)
    expect(state.roles).toHaveLength(0)
  })

  it.each([false, true])('real autosave keeps renamed identity for client/spouse and college roles (new local row: %s)', async (newLocal) => {
    const id = newLocal ? '33333333-3333-4333-8333-333333333333' : parentId
    const person = { ...parent, first_name: newLocal ? 'New' : 'Pat', id, contact_id: undefined }
    if (newLocal) expect((await autosave({ additional_contacts: [parent, person] }, publicToken)).status).toBe(200)
    const entries = Object.fromEntries(['poa', 'hcp', 'personal_rep', 'trustee', 'guardian'].flatMap((role) => ['client', 'spouse'].map((party) => [`fid_${role}_${party}`, [{ ...person, contact_id: id }]])))
    const updated = { ...person, first_name: 'Patricia' }
    const body = { additional_contacts: newLocal ? [parent, updated] : [updated], fiduciary_entries: entries, college_prep_details: { student_is_18: true } }
    expect((await autosave(body, publicToken)).status).toBe(200)
    expect((await autosave(body, publicToken)).status).toBe(200)
    expect(state.contacts.find((row) => row.id === id)?.first_name).toBe('Patricia')
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(newLocal ? 2 : 1)
    expect(state.roles.every((row) => row.contact_id === id && row.matter_id === 'matter')).toBe(true)
    expect(state.roles.some((row) => row.role === 'hcp' && row.for_party === 'spouse')).toBe(true)
    expect(state.roles.some((row) => row.role === 'poa' && row.for_party === 'client')).toBe(true)
  })

  it('rejects foreign fiduciary identity before wiping roles and supports id-less legacy matching', async () => {
    await autosave({ fiduciary_entries: { fid_poa_client: [{ ...parent, contact_id: foreignId }] } }, publicToken)
    expect(state.roles).toHaveLength(5)
    expect(state.mutations).toEqual([])
    await autosave({ fiduciary_entries: { fid_poa_client: [{ first_name: 'Pat', last_name: 'Example' }] } }, publicToken)
    expect(state.roles).toHaveLength(1)
    expect(state.roles[0].contact_id).toBe(parentId)
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(1)
  })

  it('keeps distinct same-name fiduciary IDs and leaves coagents and other matters untouched', async () => {
    const secondId = '33333333-3333-4333-8333-333333333333'
    state.contacts.push({ ...state.contacts[0], id: secondId })
    state.joins.push({ matter_id: 'matter', contact_id: secondId })
    state.roles.push({ ...state.roles[0], is_coagent: true }, { ...state.roles[0], matter_id: 'other-matter' })
    await autosave({ fiduciary_entries: { fid_poa_client: [parent, { ...parent, contact_id: secondId }] } }, publicToken)
    const managed = state.roles.filter((row) => row.matter_id === 'matter' && row.is_coagent === false)
    expect(managed.map((row) => row.contact_id)).toEqual([parentId, secondId])
    expect(state.roles.filter((row) => row.is_coagent === true || row.matter_id === 'other-matter')).toHaveLength(2)
    await autosave({ fiduciary_entries: { fid_poa_client: [] } }, publicToken)
    expect(state.roles).toHaveLength(2)
  })

  it('creates an id-less legacy nominee once and reuses the new matter membership on retry', async () => {
    const body = { fiduciary_entries: { fid_poa_client: [{ first_name: 'Legacy', last_name: 'New' }] } }
    await autosave(body, publicToken)
    await autosave(body, publicToken)
    expect(state.contacts.filter((row) => row.first_name === 'Legacy')).toHaveLength(1)
    expect(state.roles).toHaveLength(1)
    expect(state.joins.some((row) => row.matter_id === 'matter' && row.contact_id === state.roles[0].contact_id)).toBe(true)
    expect(state.mutations.filter((entry) => entry === 'contacts:insert')).toHaveLength(1)
  })
  it.each([
    { failure: false, college: false }, { failure: true, college: false },
    { failure: false, college: true }, { failure: true, college: true },
  ].flatMap((entry) => [false, true].map((rename) => ({ ...entry, rename }))))('parent edit then submit preserves unchanged roles without duplicate writes (failure: $failure, college: $college, rename: $rename)', async ({ failure, college, rename }) => {
    const compiled = compileIntakeForm({ schemaVersion: 1, key: college ? 'college_prep' : 'estate', title: 'Intake', sections: [
      { id: 'people', title: 'People', audience: 'client_and_staff', items: [{ kind: 'block', id: 'people', blockId: college ? 'college_parents' : 'additional_contacts' }] },
      { id: 'fiduciaries', title: 'Fiduciaries', audience: 'client_and_staff', items: [{ kind: 'block', id: 'fiduciaries', blockId: college ? 'college_agents' : 'client_fiduciaries' }] },
      ...(college ? [] : [{ id: 'guardian', title: 'Guardian', audience: 'client_and_staff', items: [{ kind: 'block', id: 'guardian', blockId: 'guardian' }] }]),
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    const data = applyContactIntakeData({ first_name: 'Jane', last_name: 'Example', phone: '(617) 555-0111', email: 'jane@example.com', intake_track: college ? 'college_prep' : 'estate' }, [{ ...state.contacts[0], contact_roles: state.roles }])
    render(<SchemaDrivenGuidedInterview intakeId="intake" initialData={data} compiledForm={compiled.form} publicIntakeToken={publicToken} />)
    fireEvent.change(screen.getByRole('textbox', { name: rename ? /First name/i : college ? 'Cell phone' : 'Phone' }), { target: { value: rename ? 'Patricia' : '(617) 555-0199' } })
    state.strictFailOnce = failure
    // A section leave and immediate submit race must share one contact save.
    if (!failure) fireEvent.click(screen.getAllByRole('button', { name: /Fiduciaries/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: /Review questionnaire/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
    if (failure) {
      await waitFor(() => expect(state.error).toHaveBeenCalled())
      expect(state.submits).toBe(0)
      expect(state.roles).toHaveLength(5)
      await waitFor(() => expect((screen.getByRole('button', { name: 'Submit questionnaire' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
    }
    await waitFor(() => expect(state.submits).toBe(1))
    expect(state.roles.map((role) => role.role).sort()).toEqual([...roles].sort())
    expect(state.roles.every((role) => role.contact_id === parentId)).toBe(true)
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(1)
    expect(state.contacts.find((row) => row.id === parentId)?.[rename ? 'first_name' : 'phone']).toBe(rename ? 'Patricia' : '(617) 555-0199')
    expect(state.mutations.filter((entry) => entry.startsWith('contacts:'))).toEqual(['contacts:update'])
    expect(state.requests).toHaveLength(failure ? 2 : 1)
    expect(state.requests[0].headers.get(publicToken ? 'x-intake-token' : 'authorization')).toBe(publicToken ?? 'Bearer session')
  })

  it('blocks submission after an incomplete UI edit, preserves roles through autosave/leave, and retries after correction', async () => {
    const compiled = compileIntakeForm({ schemaVersion: 1, key: 'estate', title: 'Intake', sections: [
      { id: 'people', title: 'People', audience: 'client_and_staff', items: [{ kind: 'block', id: 'people', blockId: 'additional_contacts' }] },
      { id: 'fiduciaries', title: 'Fiduciaries', audience: 'client_and_staff', items: [{ kind: 'block', id: 'fiduciaries', blockId: 'client_fiduciaries' }] },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    const data = applyContactIntakeData({ first_name: 'Jane', last_name: 'Example', phone: '(617) 555-0111', email: 'jane@example.com' }, [{ ...state.contacts[0], contact_roles: state.roles }])
    render(<SchemaDrivenGuidedInterview intakeId="intake" initialData={data} compiledForm={compiled.form} publicIntakeToken={publicToken} />)
    fireEvent.change(screen.getByRole('textbox', { name: /First name/i }), { target: { value: '' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Fiduciaries/ })[0])
    await waitFor(() => expect(state.error).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: /Review questionnaire/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Submit questionnaire' }) as HTMLButtonElement).disabled).toBe(false))
    expect(state.submits).toBe(0)
    expect(state.roles).toHaveLength(5)
    expect(state.contacts.find((row) => row.id === parentId)?.first_name).toBe('Pat')
    fireEvent.click(screen.getAllByRole('button', { name: /People/ })[0])
    fireEvent.change(screen.getByRole('textbox', { name: /First name/i }), { target: { value: 'Patricia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
    await waitFor(() => expect(state.submits).toBe(1))
    expect(state.contacts.find((row) => row.id === parentId)?.first_name).toBe('Patricia')
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(1)
    expect(state.roles).toHaveLength(5)
    expect(state.roles.every((row) => row.contact_id === parentId)).toBe(true)
  })

  it('rejects a foreign contact ID before modifying the current household', async () => {
    const response = await POST(request([{ ...parent, contact_id: foreignId, phone: '(617) 555-0199' }], publicToken))
    expect(response.status).toBe(400)
    expect(state.mutations).toEqual([])
    expect(state.contacts.find((row) => row.id === parentId)?.phone).toBe('(617) 555-0101')
    expect(state.roles).toHaveLength(5)
  })

  it('renames a scoped identity without changing its roles', async () => {
    expect((await POST(request([{ ...parent, first_name: 'Patricia' }], publicToken))).status).toBe(200)
    expect(state.contacts.find((row) => row.id === parentId)?.first_name).toBe('Patricia')
    expect(state.roles).toHaveLength(5)
  })

  it('preserves identity when renaming the actual hydrated additional-contact row', async () => {
    const hydrated = applyContactIntakeData({}, state.contacts.filter((row) => row.client_intake_id === 'intake'))
    const entries = hydrated._additional_contacts as Row[]
    expect(entries[0].id).toBe(parentId)
    expect((await POST(request([{ ...entries[0], first_name: 'Patricia' }], publicToken))).status).toBe(200)
    expect(state.contacts.find((row) => row.id === parentId)?.first_name).toBe('Patricia')
    expect(state.roles).toHaveLength(5)
  })

  it('preserves the same people and roles across autosave and strict contact persistence', async () => {
    const hydrated = applyContactIntakeData({}, state.contacts.filter((row) => row.client_intake_id === 'intake'))
    const entries = (hydrated._additional_contacts as Row[]).map((row) => ({ ...row, phone: '(617) 555-0199' }))
    await saveAdditionalContacts(getAdminClient(), 'intake', entries)
    expect(state.roles).toHaveLength(5)
    expect(state.contacts.find((row) => row.id === parentId)?.phone).toBe('(617) 555-0199')
    expect((await POST(request(entries, publicToken))).status).toBe(200)
    expect(state.roles).toHaveLength(5)
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(1)
    expect(state.mutations).toEqual(['contacts:update'])
  })

  it('matches an id-less historical row by unique name on repeat saves without inserting duplicates', async () => {
    const entry = { first_name: 'Pat', last_name: 'Example', phone: '(617) 555-0199' }
    expect((await POST(request([entry], publicToken))).status).toBe(200)
    expect((await POST(request([entry], publicToken))).status).toBe(200)
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(1)
    expect(state.contacts.find((row) => row.id === parentId)?.phone).toBe('(617) 555-0199')
    expect(state.roles).toHaveLength(5)
    expect(state.mutations).toEqual(['contacts:update'])
  })

  it('rejects duplicate incoming identities before any writes', async () => {
    expect((await POST(request([parent, { ...parent, first_name: 'Renamed' }], publicToken))).status).toBe(400)
    expect(state.mutations).toEqual([])
  })

  it('retries a new person after a membership failure without inserting a second contact', async () => {
    const added = { first_name: 'New', last_name: 'Person', phone: '(617) 555-0123' }
    state.attachFailOnce = true
    // Put the new person first so the injected membership error follows insert.
    expect((await POST(request([added, parent], publicToken))).status).toBe(500)
    expect(state.contacts.filter((row) => row.first_name === 'New')).toHaveLength(1)
    expect((await POST(request([added, parent], publicToken))).status).toBe(200)
    expect(state.contacts.filter((row) => row.first_name === 'New')).toHaveLength(1)
    expect(state.roles).toHaveLength(5)
    expect(state.mutations.filter((entry) => entry === 'contacts:insert')).toHaveLength(1)
  })

  it('rejects ambiguous id-less names but accepts distinct scoped IDs', async () => {
    const second = { ...state.contacts[0], id: 'third-contact' }
    state.contacts.push(second)
    expect((await POST(request([{ first_name: 'Pat', last_name: 'Example' }], publicToken))).status).toBe(400)
    expect(state.mutations).toEqual([])
    expect((await POST(request([parent, { ...second, contact_id: 'third-contact' }], publicToken))).status).toBe(200)
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(2)
    expect(state.roles).toHaveLength(5)
  })

  it('does not accept a contact from another source within the same intake', async () => {
    state.contacts[1].client_intake_id = 'intake'
    state.contacts[1].source = 'attorney'
    expect((await POST(request([{ ...parent, contact_id: foreignId }], publicToken))).status).toBe(400)
    expect(state.mutations).toEqual([])
  })

  it('preserves a new UI row identity through its first save and a later rename before refresh', async () => {
    const added = { id: '33333333-3333-4333-8333-333333333333', first_name: 'New', last_name: 'Person' }
    expect((await POST(request([parent, added], publicToken))).status).toBe(200)
    const saved = state.contacts.find((row) => row.first_name === 'New')!
    state.roles.push({ contact_id: saved.id, role: 'hcp', for_party: 'spouse', client_intake_id: 'intake' })
    expect((await POST(request([parent, { ...added, first_name: 'Renamed' }], publicToken))).status).toBe(200)
    expect(state.contacts.find((row) => row.id === added.id)?.first_name).toBe('Renamed')
    expect(state.roles.some((row) => row.contact_id === added.id && row.for_party === 'spouse')).toBe(true)
    expect(state.mutations.filter((entry) => entry === 'contacts:insert')).toHaveLength(1)
  })

  it('cannot use a foreign UI row ID to update or replace an out-of-scope person', async () => {
    const foreign = { ...state.contacts.find((row) => row.id === foreignId)! }
    const response = await POST(request([parent, { id: foreignId, first_name: 'Intruder', last_name: 'Replacement' }], publicToken))
    expect(response.status).toBe(500)
    expect(state.contacts.find((row) => row.id === foreignId)).toEqual(foreign)
    expect(state.contacts.some((row) => row.first_name === 'Intruder')).toBe(false)
    expect(state.roles).toHaveLength(5)
    expect(state.mutations).not.toContain('contacts:delete')
  })

  it('rejects duplicate new UI identities before writing any rows', async () => {
    const first = { id: '33333333-3333-4333-8333-333333333333', first_name: 'New', last_name: 'Person' }
    expect((await POST(request([parent, first, { ...first, first_name: 'Different' }], publicToken))).status).toBe(400)
    expect(state.mutations).toEqual([])
  })
})
