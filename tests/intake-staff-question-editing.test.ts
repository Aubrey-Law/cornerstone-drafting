import { ESTATE_INTAKE_FORM } from '@/lib/intake/forms/definitions'
import { beforeEach, expect, it, vi } from 'vitest'
import { staffContactSnapshot } from '@/lib/intake/forms/staffContactEditing'
import { saveStaffQuestionRow } from '@/lib/intake/forms/staffQuestionEditing'
const state = vi.hoisted(() => ({ version: vi.fn() }))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: async (_db: unknown, row: unknown) => row }))
vi.mock('@/lib/intake/forms/repository', () => ({ getVersionRow: state.version, getTemplateRow: async () => ({ key: 'custom' }) }))
const definition = { schemaVersion: 1, key: 'custom', title: 'Custom', sections: [
  { id: 'college', title: 'College', audience: 'client_and_staff', items: [
    { kind: 'field', id: 'school', fieldId: 'college_school_name' },
    { kind: 'field', id: 'date', fieldId: 'college_move_in_date' },
    { kind: 'field', id: 'abroad', fieldId: 'college_studying_abroad' },
    { kind: 'field', id: 'country', fieldId: 'college_abroad_country', condition: { fieldId: 'college_studying_abroad', op: 'equals', value: true } },
    { kind: 'field', id: 'powers', fieldId: 'college_dpoa_powers' },
    { kind: 'field', id: 'notes', fieldId: 'special_notes' },
    { kind: 'block', id: 'objectives', blockId: 'planning_objectives' },
    { kind: 'block', id: 'assets', blockId: 'financial_assets' },
    { kind: 'block', id: 'parents', blockId: 'college_parents' },
    { kind: 'block', id: 'agents', blockId: 'college_agents' },
    { kind: 'block', id: 'hipaa', blockId: 'college_hipaa_recipients' },
  ] },
  { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] }
const args = { intakeId: 'intake', expectedVersionId: 'version', expectedUpdatedAt: '2026-10-09T12:00:00Z', fieldId: 'college_school_name', value: 'New school' }
function database(overrides: Record<string, unknown> = {}, conflict = false) {
  const row = { id: 'intake', form_version_id: 'version', intake_track: 'college_prep', status: 'draft', updated_at: args.expectedUpdatedAt,
    college_prep_details: { school_name: 'Old school', studying_abroad: false, hipaa_recipients: [{ first_name: 'Preserve' }], unknown: { nested: true } }, ...overrides }
  const writes: Record<string, unknown>[] = []
  const filters: [string, unknown][] = []
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const client = { rpc, from: () => {
    let updating = false
    const chain = { select: () => chain,
      eq: (k: string, v: unknown) => { if (updating) filters.push([k, v]); return chain },
      is: (k: string, v: unknown) => { if (updating) filters.push([k, v]); return chain },
      update: (v: Record<string, unknown>) => { updating = true; writes.push(v); return chain },
      maybeSingle: async () => ({ data: updating ? conflict ? null : { id: 'intake' } : row, error: null }) }
    return chain
  } }
  return { row, writes, filters, rpc, client: client as unknown as Parameters<typeof saveStaffQuestionRow>[0] }
}
beforeEach(() => { state.version.mockReset().mockResolvedValue({ template_id: 'template', status: 'published', definition }) })
it('dispatches one appointment slot with the version and saved snapshot, without a separate intake write', async () => {
  const db = database()
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_agents', value: {
    matterId: null, role: 'hcp', party: 'client', priority: 2, coagent: false,
    contactId: '20000000-0000-0000-0000-000000000001', expected: [],
  } })
  expect(db.rpc).toHaveBeenCalledWith('edit_pinned_intake_appointment', expect.objectContaining({
    p_intake_id: 'intake', p_version_id: 'version', p_updated_at: args.expectedUpdatedAt,
    p_role: 'hcp', p_party: 'client', p_priority: 2, p_expected: [],
  }))
  expect(db.writes).toEqual([])
})
it('changes just the requested JSON leaf, preserving nested/unknown answers and guarding the snapshot', async () => {
  const db = database()
  await saveStaffQuestionRow(db.client, args)
  expect(db.writes).toEqual([{ college_prep_details: { ...db.row.college_prep_details, school_name: 'New school' }, updated_at: expect.any(String) }])
  expect(db.filters).toEqual([['id', 'intake'], ['form_version_id', 'version'], ['updated_at', args.expectedUpdatedAt], ['status', 'draft']])
})
it('updates notes without serializing college answers or contact data', async () => {
  const db = database()
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'special_notes', value: '  New notes  ' })
  expect(db.writes).toEqual([{ special_notes: 'New notes', updated_at: expect.any(String) }])
})
it.each([
  ['college_abroad_country', 'France'], ['client_first_name', 'Ada'], ['form_version_id', 'other'], ['college_unknown', 'bad'],
  ['college_school_name', {}], ['college_studying_abroad', 'yes'], ['college_dpoa_powers', ['invented']],
  ['college_move_in_date', '2026-02-30'], ['college_move_in_date', 'not a date'],
])('rejects inactive, unsupported or invalid answers: %s %s', async (fieldId, value) => {
  const db = database()
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId, value })).rejects.toThrow()
  expect(db.writes).toEqual([])
})
it.each(['submitted', 'approved'])('does not change a %s questionnaire', async status => {
  const db = database({ status })
  await expect(saveStaffQuestionRow(db.client, args)).rejects.toThrow('already been submitted')
  expect(db.writes).toEqual([])
})
it.each([{ form_version_id: null }, { form_version_id: 'other' }, { updated_at: 'newer' }])('rejects stale snapshots before resolving or writing', async override => {
  const db = database(override)
  await expect(saveStaffQuestionRow(db.client, args)).rejects.toThrow('changed')
  expect(db.writes).toEqual([])
  expect(state.version).not.toHaveBeenCalled()
})
it('fails closed when the pinned version is unavailable', async () => {
  state.version.mockResolvedValue(null)
  const db = database()
  await expect(saveStaffQuestionRow(db.client, args)).rejects.toThrow()
  expect(db.writes).toEqual([])
})
it('reports a concurrent write conflict', async () => {
  await expect(saveStaffQuestionRow(database({}, true).client, args)).rejects.toThrow('changed')
})
it.each([['college_school_name', ''], ['college_studying_abroad', false], ['college_studying_abroad', null], ['college_dpoa_powers', []]])('allows incomplete draft answers %s %s', async (fieldId, value) => {
  const db = database()
  await saveStaffQuestionRow(db.client, { ...args, fieldId, value })
  expect(db.writes[0].college_prep_details).toMatchObject({ [fieldId.slice(8)]: value === '' ? null : value })
})

const recipient = { id: 'recipient-1', name: 'Parent', relationship: 'Mother', phone: '', email: 'parent@example.test' }
it('adds, edits and removes recipients without changing other answers or surviving metadata', async () => {
  const db = database({ college_prep_details: { school_name: 'Preserve school', hipaa_scope: 'all', hipaa_recipients: [
    { ...recipient, source: { legacy: true } }, { ...recipient, id: 'removed' },
  ] } })
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_hipaa_recipients', value: [
    { ...recipient, name: 'Updated parent' }, { ...recipient, id: 'added', name: 'Sibling' },
  ] })
  expect(db.writes).toEqual([{ updated_at: expect.any(String), college_prep_details: {
    school_name: 'Preserve school', hipaa_scope: 'all', hipaa_recipients: [
      { ...recipient, name: 'Updated parent', source: { legacy: true } }, { ...recipient, id: 'added', name: 'Sibling' },
    ],
  } }])
  expect(db.filters).toContainEqual(['updated_at', args.expectedUpdatedAt])
})
it.each([
  null, {}, [null], [{ ...recipient, email: 'invalid' }], [{ ...recipient, name: 123 }],
  [{ ...recipient, id: '' }], [recipient, recipient], [{ ...recipient, source: 'injected' }],
  Array.from({ length: 101 }, (_, i) => ({ ...recipient, id: String(i) })),
])('rejects malformed or tampered recipient payloads %#', async value => {
  const db = database({ college_prep_details: { hipaa_recipients: [recipient] } })
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_hipaa_recipients', value })).rejects.toThrow()
  expect(db.writes).toEqual([])
})
it.each([{}, [null], [{ name: 'Missing ID' }], [recipient, recipient]])('fails closed on malformed stored recipient data %#', async stored => {
  const db = database({ college_prep_details: { hipaa_recipients: stored } })
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_hipaa_recipients', value: [] })).rejects.toThrow('needs review')
  expect(db.writes).toEqual([])
})
it('allows removal of all recipients from a draft', async () => {
  const db = database({ college_prep_details: { hipaa_recipients: [recipient] } })
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_hipaa_recipients', value: [] })
  expect(db.writes[0].college_prep_details).toEqual({ hipaa_recipients: [] })
})
it('does not save a hidden recipient block', async () => {
  const hidden = structuredClone(definition)
  Object.assign(hidden.sections[0].items.at(-1)!, { condition: { fieldId: 'college_studying_abroad', op: 'equals', value: true } })
  state.version.mockResolvedValue({ template_id: 'template', status: 'published', definition: hidden })
  const db = database({ college_prep_details: { studying_abroad: false, hipaa_recipients: [recipient] } })
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_hipaa_recipients', value: [] })).rejects.toThrow('not active')
  expect(db.writes).toEqual([])
})
it('rejects concurrent recipient updates with the same snapshot guards', async () => {
  const db = database({ college_prep_details: { hipaa_recipients: [recipient] } }, true)
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_hipaa_recipients', value: [] })).rejects.toThrow('changed')
})

const objectiveAnswers = { why_choose_firm: 'Referral', why_now: 'New child', make_things_easy: 'Yes' }
it.each([
  ['Legacy staff notes', { notes: 'Legacy staff notes' }],
  [JSON.stringify({ notes: 'Staff notes', unknown: { preserve: true }, why_now: 'Old answer' }), { notes: 'Staff notes', unknown: { preserve: true } }],
  [{ notes: 'Object notes', extra: 'Keep' }, { notes: 'Object notes', extra: 'Keep' }],
  [null, {}],
])('preserves historical planning data while writing only questionnaire answers: %s', async (stored, preserved) => {
  const db = database({ planning_objectives: stored })
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'planning_objectives', value: objectiveAnswers })
  expect(db.writes).toEqual([{ planning_objectives: expect.any(String), updated_at: expect.any(String) }])
  expect(JSON.parse(db.writes[0].planning_objectives as string)).toEqual({ ...preserved, ...objectiveAnswers })
})
it.each([null, [], {}, { ...objectiveAnswers, why_now: false }, { ...objectiveAnswers, notes: 'Overwrite notes' }, { ...objectiveAnswers, why_now: 'x'.repeat(20001) }])('rejects invalid or overreaching planning payloads %#', async value => {
  const db = database()
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'planning_objectives', value })).rejects.toThrow()
  expect(db.writes).toEqual([])
})
it('clears questionnaire answers without removing staff notes', async () => {
  const db = database({ planning_objectives: JSON.stringify({ ...objectiveAnswers, notes: 'Retain' }) })
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'planning_objectives', value: { why_choose_firm: '', why_now: '', make_things_easy: '' } })
  expect(JSON.parse(db.writes[0].planning_objectives as string)).toEqual({ why_choose_firm: '', why_now: '', make_things_easy: '', notes: 'Retain' })
})
it('rejects planning writes when the block is absent', async () => {
  const other = structuredClone(definition)
  other.sections[0].items = other.sections[0].items.filter(item => item.id !== 'objectives')
  state.version.mockResolvedValue({ template_id: 'template', status: 'published', definition: other })
  const db = database()
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'planning_objectives', value: objectiveAnswers })).rejects.toThrow('not active')
  expect(db.writes).toEqual([])
})
it('fails closed for malformed stored planning answers', async () => {
  const db = database({ planning_objectives: JSON.stringify({ why_now: { malformed: true } }) })
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'planning_objectives', value: objectiveAnswers })).rejects.toThrow('need review')
  expect(db.writes).toEqual([])
})

it('writes only financial JSON and the timestamp through the pinned snapshot guard', async () => {
  const db = database({ financial_details: { asset_types: ['real_estate'], preserved: 'yes' } })
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'financial_assets', value: { asset_types: ['bank_accounts'] } })
  expect(db.writes).toEqual([{ financial_details: { asset_types: ['bank_accounts'], preserved: 'yes' }, updated_at: expect.any(String) }])
  expect(db.filters).toContainEqual(['form_version_id', 'version'])
  expect(db.filters).toContainEqual(['updated_at', args.expectedUpdatedAt])
})
it('rejects financial editing when its block is absent', async () => {
  const other = structuredClone(definition)
  other.sections[0].items = other.sections[0].items.filter(item => item.id !== 'assets')
  state.version.mockResolvedValue({ template_id: 'template', status: 'published', definition: other })
  const db = database()
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'financial_assets', value: {} })).rejects.toThrow('not active')
  expect(db.writes).toEqual([])
})

it('dispatches active parent edits through the atomic RPC without separate writes', async () => {
  const db = database()
  const edit = { contactId: '20000000-0000-0000-0000-000000000001', expected: staffContactSnapshot({ first_name: 'Ada', last_name: 'Parent' }), patch: { email: 'new@example.test' } }
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_parents', value: edit })
  expect(db.rpc).toHaveBeenCalledWith('edit_pinned_intake_contact', { p_intake_id: 'intake', p_version_id: 'version', p_updated_at: args.expectedUpdatedAt, p_contact_id: edit.contactId, p_expected: edit.expected, p_patch: edit.patch })
  expect(db.writes).toEqual([])
})
it('surfaces contact snapshot conflicts from the atomic RPC', async () => {
  const db = database()
  db.rpc.mockResolvedValue({ error: { message: 'The contact changed.' } })
  await expect(saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_parents', value: { contactId: '20000000-0000-0000-0000-000000000001', expected: staffContactSnapshot({ first_name: 'Ada', last_name: 'Parent' }), patch: { email: 'new@example.test' } } })).rejects.toThrow('contact changed')
  expect(db.writes).toEqual([])
})

it.each(['add', 'remove'])('dispatches %s through the atomic membership RPC', async operation => {
  const db = database()
  const contactId = '20000000-0000-0000-0000-000000000001'
  const expected = staffContactSnapshot({ first_name: 'Ada', last_name: 'Parent' })
  const value = operation === 'add' ? { operation, contactId, patch: { first_name: 'New', last_name: 'Person' } } : { operation, contactId, expected }
  await saveStaffQuestionRow(db.client, { ...args, fieldId: 'college_parents', value })
  expect(db.rpc).toHaveBeenCalledWith('change_pinned_intake_contact_membership', expect.objectContaining({ p_operation: operation, p_contact_id: contactId, p_updated_at: args.expectedUpdatedAt }))
  expect(db.writes).toEqual([])
})

it.each([
  ['client_first_name', 'New', { first_name: 'New', full_name: 'New M Last' }],
  ['client_dob', '', { date_of_birth: null }],
  ['planning_goals', ['avoid_probate'], { planning_goals: ['avoid_probate'] }],
  ['client_citizenship', 'Permanent Resident', { citizenship_status: 'permanent_resident', is_us_citizen: false }],
  ['address', { street_address: 'New street', city: 'Boston' }, { address_line1: 'New street', city: 'Boston' }],
  ['referral_source', 'Other', { referral_source: 'Other', family_details: { notes: 'preserve', referral: { source: 'Other', referral_name: 'Keep' } } }],
])('persists canonical scalar/group storage for %s without losing unrelated answers', async (fieldId, value, expected) => {
  state.version.mockResolvedValue({ template_id: 'template', status: 'published', definition: { ...ESTATE_INTAKE_FORM, key: 'custom' } })
  const db = database({ intake_track: 'estate', first_name: 'Old', middle_name: 'M', last_name: 'Last', family_details: { notes: 'preserve', referral: { source: 'referral', referral_name: 'Keep' } } })
  await saveStaffQuestionRow(db.client, { ...args, fieldId, value })
  expect(db.writes).toEqual([{ ...expected, updated_at: expect.any(String) }])
})
