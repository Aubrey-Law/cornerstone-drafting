// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SchemaDrivenGuidedInterview from '@/components/intake/SchemaDrivenGuidedInterview'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { POST } from '@/app/api/intake/contacts/route'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'
import { saveAdditionalContacts } from '@/lib/contacts/saveAdditionalContacts'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ contacts: [] as Row[], roles: [] as Row[], mutations: [] as string[], failOnce: false, failReadOnce: false, strictFailOnce: false, attachFailOnce: false, submits: 0, requests: [] as Request[], error: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }) } } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken: async () => ({ id: 'intake', status: 'draft' }) }))
vi.mock('@/lib/contacts/attachContactToMatter', () => ({ attachContactToMatter: async () => { if (state.attachFailOnce) { state.attachFailOnce = false; throw new Error('Membership save failed') } }, matterIdForIntake: async () => 'matter' }))
vi.mock('sonner', () => ({ toast: { error: state.error } }))
vi.mock('@/components/intake/LegacyGuidedInterview', () => ({ ReviewModal: ({ onSubmit, submitting }: { onSubmit: () => void; submitting: boolean }) => <button disabled={submitting} onClick={onSubmit}>Submit questionnaire</button> }))
// Only the database transport is replaced. It models scoped queries and the
// contact_roles ON DELETE CASCADE that made the old replacement unsafe.
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  let verb = 'select'
  let payload: Row | Row[] = {}
  const filters: Array<(row: Row) => boolean> = []
  let result: { data: Row[]; error: { message: string } | null } | undefined
  const execute = () => {
    if (result) return result
    if (table === 'client_intake') return { data: [{ id: 'intake' }], error: null }
    if (table === 'contacts' && verb === 'select' && state.failReadOnce) {
      state.failReadOnce = false
      return result = { data: [], error: { message: 'Temporary contact read failure' } }
    }
    const rows = table === 'contacts' ? state.contacts : state.roles
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
beforeEach(() => {
  state.contacts = [{ ...parent, relationship_type: 'other', client_intake_id: 'intake', source: 'client_intake_additional' }, { id: foreignId, first_name: 'Other', last_name: 'Person', client_intake_id: 'other-intake', source: 'client_intake_additional' }]
  state.roles = roles.map((role) => ({ contact_id: parentId, client_intake_id: 'intake', role, for_party: 'client', priority: 1 }))
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
    if (body.status !== 'submitted') {
      // Exercise the actual autosave payload and the domain writer used by
      // both branches of /api/intake; intake-row SQL is outside this regression.
      try {
        await saveAdditionalContacts(getAdminClient(), body.existingId, body.additional_contacts ?? [])
        return Response.json({ ok: true })
      } catch { return Response.json({ ok: true }) } // Existing autosave treats domain failures as nonfatal.
    }
    state.submits++
    return Response.json({ ok: true })
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe.each([undefined, 'invite'])('contact identity through intake save (%s)', (publicToken) => {
  it.each([
    { failure: false, college: false }, { failure: true, college: false },
    { failure: false, college: true }, { failure: true, college: true },
  ])('parent phone edit then submit preserves unchanged roles without duplicate writes (failure: $failure, college: $college)', async ({ failure, college }) => {
    const compiled = compileIntakeForm({ schemaVersion: 1, key: college ? 'college_prep' : 'estate', title: 'Intake', sections: [
      { id: 'people', title: 'People', audience: 'client_and_staff', items: [{ kind: 'block', id: 'people', blockId: college ? 'college_parents' : 'additional_contacts' }] },
      { id: 'fiduciaries', title: 'Fiduciaries', audience: 'client_and_staff', items: [{ kind: 'block', id: 'fiduciaries', blockId: college ? 'college_agents' : 'client_fiduciaries' }] },
      ...(college ? [] : [{ id: 'guardian', title: 'Guardian', audience: 'client_and_staff', items: [{ kind: 'block', id: 'guardian', blockId: 'guardian' }] }]),
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    const data = applyContactIntakeData({ first_name: 'Jane', last_name: 'Example', phone: '(617) 555-0111', email: 'jane@example.com', intake_track: college ? 'college_prep' : 'estate' }, [{ ...state.contacts[0], contact_roles: state.roles }])
    render(<SchemaDrivenGuidedInterview intakeId="intake" initialData={data} compiledForm={compiled.form} publicIntakeToken={publicToken} />)
    fireEvent.change(screen.getByRole('textbox', { name: college ? 'Cell phone' : 'Phone' }), { target: { value: '(617) 555-0199' } })
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
    expect(state.roles.map((role) => role.role)).toEqual(roles)
    expect(state.roles.every((role) => role.contact_id === parentId)).toBe(true)
    expect(state.contacts.filter((row) => row.client_intake_id === 'intake')).toHaveLength(1)
    expect(state.contacts.find((row) => row.id === parentId)?.phone).toBe('(617) 555-0199')
    expect(state.mutations).toEqual(['contacts:update'])
    expect(state.requests).toHaveLength(failure ? 2 : 1)
    expect(state.requests[0].headers.get(publicToken ? 'x-intake-token' : 'authorization')).toBe(publicToken ?? 'Bearer session')
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
