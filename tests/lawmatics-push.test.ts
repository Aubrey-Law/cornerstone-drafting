import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({ from: vi.fn(), settings: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/integrations/settings', () => ({ getIntegrationSettings: mocks.settings }))
vi.mock('@/lib/integrations/lawmatics/client', () => ({
  createLawmaticsProspect: vi.fn(), createLawmaticsProspectFromBody: mocks.create, updateLawmaticsProspect: mocks.update,
}))
import { buildLawmaticsProspectBody } from '@/lib/integrations/lawmatics/pushFields'
import { pushLeadToLawmatics } from '@/lib/integrations/lawmatics/push'
import { resolveLawmaticsProspect } from '@/lib/integrations/lawmatics/prospect'
import { LawmaticsValidationError, parseLawmaticsValidation } from '@/lib/integrations/lawmatics/validation'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let customFieldMap: Record<string, string>
const prospectRecord = () => db.integration_external_records.find(row => row.external_record_type === 'prospect')

// Stateful persistence boundary: the real record repository (claims, fenced
// attempts, compare-and-swap updates) runs against in-memory rows.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let insertion: Row | undefined
  const rows = () => (db[table] ?? []).filter(row => filters.every(filter => filter(row)))
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q },
    is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
    order: () => q,
    update: (value: Row) => { patch = value; return q },
    upsert: (value: Row) => { insertion = value; return q },
    maybeSingle: async () => {
      if (insertion) {
        const keys = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
        if ((db[table] ?? []).some(row => keys.every(key => row[key] === insertion![key]))) return { data: null, error: null }
        const created = { id: `record-${db[table].length}`, external_id: null, last_attempt_at: null,
          last_error_code: null, last_succeeded_at: null, metadata: {}, ...insertion }
        db[table].push(created)
        return { data: { ...created }, error: null }
      }
      const row = rows()[0]
      if (row && patch) Object.assign(row, patch)
      return { data: row ? { ...row } : null, error: null }
    },
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: rows().map(row => ({ ...row })), error: null })),
  }
  return q
}

const INTAKE_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  customFieldMap = { county: '621072', spouse_first_name: '700001', children: '244367' }
  db = {
    client_intake: [{
      id: INTAKE_ID, first_name: ' Ada ', middle_name: 'King', last_name: 'Lovelace', email: 'ada@example.test',
      phone: '5551234567', date_of_birth: '1815-12-10', marital_status: 'domestic_partner',
      address_line1: '12 St James Sq', address_line2: 'Apt 2', city: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108',
      lead_source: 'referral', plan_type: '', notes: 'Internal only', lawmatics_matter_id: null,
      suffix: 'Jr.', preferred_name: 'Countess', occupation: 'Mathematician', legal_plan_member_id: 'LP-1',
    }],
    matters: [],
    contacts: [
      { id: 'c-spouse', client_intake_id: INTAKE_ID, relationship_type: 'spouse', first_name: 'William', last_name: 'King',
        email: null, phone: null, date_of_birth: null },
      { id: 'c-child', client_intake_id: INTAKE_ID, relationship_type: 'child', first_name: 'Byron', last_name: 'King',
        email: null, phone: null, date_of_birth: null },
    ],
    matter_contacts: [],
    integration_external_records: [],
  }
  mocks.settings.mockImplementation(async () => ({ lawmaticsCustomFieldIdMap: customFieldMap }))
  mocks.from.mockImplementation(query)
  mocks.create.mockResolvedValue({ id: 'prospect-1', type: 'prospect' })
  mocks.update.mockResolvedValue(undefined)
})

describe('buildLawmaticsProspectBody', () => {
  it('sends standard fields directly and only mapped custom fields, omitting blanks', () => {
    const { body, sentKeys, unmappedKeys } = buildLawmaticsProspectBody({
      intake: { first_name: 'Ada', last_name: 'Lovelace', marital_status: 'married', date_of_birth: '1815-02-30',
        county: 'Suffolk', middle_name: 'King', city: '  ', email: null, preferred_pronoun: 'she/her' },
      matterNumber: '2026-014',
      spouse: null,
      children: [],
    }, { county: '621072', notes: '700002' })

    expect(body).toEqual({
      first_name: 'Ada', middle_name: 'King', last_name: 'Lovelace', marital_status: 'Married', case_number: '2026-014',
      custom_fields: [{ id: '621072', value: 'Suffolk' }],
    })
    expect(sentKeys).toEqual(['first_name', 'middle_name', 'last_name', 'marital_status', 'matter_number', 'county'])
    // An invalid calendar date is not sent; an unmapped value is reported.
    expect(unmappedKeys).toEqual(['preferred_pronoun'])
  })
})

describe('pushLeadToLawmatics', () => {
  it('creates a prospect with every field, then updates the same prospect on the next push', async () => {
    const first = await pushLeadToLawmatics(INTAKE_ID)

    expect(first).toMatchObject({ prospectId: 'prospect-1', operation: 'created' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0]).toEqual({
      first_name: 'Ada', middle_name: 'King', last_name: 'Lovelace', name_suffix: 'Jr.', informal_name: 'Countess',
      email: 'ada@example.test', phone: '5551234567',
      birthdate: '1815-12-10', street: '12 St James Sq', street2: 'Apt 2', city: 'Boston', state: 'MA', zipcode: '02108',
      marital_status: 'Domestic Partner', occupation: 'Mathematician',
      custom_fields: [
        { id: '621072', value: 'Suffolk' },
        { id: '700001', value: 'William' },
        { id: '244367', value: 'Byron King' },
      ],
    })
    expect(first.unmapped).toEqual(['Source', 'Campaign', 'Spouse last name', 'Lead source', 'Legal plan member ID', 'Internal notes'])
    expect(prospectRecord()).toMatchObject({ external_id: 'prospect-1', status: 'synced' })

    db.client_intake[0].city = 'Cambridge'
    const second = await pushLeadToLawmatics(INTAKE_ID)

    expect(second).toMatchObject({ prospectId: 'prospect-1', operation: 'updated' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith('prospect-1', expect.objectContaining({ city: 'Cambridge' }))
    expect(prospectRecord()).toMatchObject({ external_id: 'prospect-1', status: 'synced' })
  })

  it('shares the prospect link with appointment sync', async () => {
    await pushLeadToLawmatics(INTAKE_ID)
    db.appointments = [{ id: 'appt-1', source: 'public', status: 'scheduled', linked_lead_id: INTAKE_ID, linked_matter_id: null }]

    await expect(resolveLawmaticsProspect('appt-1')).resolves.toBe('prospect-1')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('updates the prospect a legacy Lawmatics import linked, never creating a duplicate', async () => {
    db.client_intake[0].lawmatics_matter_id = 'legacy-9'

    await expect(pushLeadToLawmatics(INTAKE_ID)).resolves.toMatchObject({ prospectId: 'legacy-9', operation: 'updated' })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith('legacy-9', expect.any(Object))
    expect(prospectRecord()).toMatchObject({ external_id: 'legacy-9', status: 'synced' })
  })

  it('reads a hired client household from the matter membership', async () => {
    db.matters = [{ id: 'matter-1', client_intake_id: INTAKE_ID, matter_number: '2026-014' }]
    db.contacts[0].relationship_type = null
    db.matter_contacts = [{ matter_id: 'matter-1', contact_id: 'c-spouse', relationship_type: 'spouse' }]

    await pushLeadToLawmatics(INTAKE_ID)
    // A hired client's matter number goes to the Lawmatics Case Number.
    expect(mocks.create.mock.calls[0][0].case_number).toBe('2026-014')
    expect(mocks.create.mock.calls[0][0].custom_fields).toEqual([
      { id: '621072', value: 'Suffolk' },
      { id: '700001', value: 'William' },
    ])
  })

  it('requires first and last names before creating a prospect', async () => {
    db.client_intake[0].last_name = ' '

    await expect(pushLeadToLawmatics(INTAKE_ID)).rejects.toMatchObject({ code: 'identity_required' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses to create again after a create whose outcome is unknown', async () => {
    db.integration_external_records.push({
      id: 'r1', provider: 'lawmatics', internal_entity_type: 'lead', internal_entity_id: INTAKE_ID,
      external_record_type: 'prospect', external_id: null, status: 'pending', source_version: 'v0',
      idempotency_key: 'lawmatics:prospect:old', request_hash: 'v0', request_snapshot: {},
      last_attempt_at: '2026-01-01T00:00:00.000Z', last_error_code: null, metadata: {},
    })

    await expect(pushLeadToLawmatics(INTAKE_ID)).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('keeps the prospect link when Lawmatics rejects an update', async () => {
    await pushLeadToLawmatics(INTAKE_ID)
    mocks.update.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'attention',
      code: 'validation_failed', safeMessage: 'Lawmatics rejected the supplied record fields.', retryAfterMs: null }))

    await expect(pushLeadToLawmatics(INTAKE_ID)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(prospectRecord()).toMatchObject({ external_id: 'prospect-1', status: 'attention', last_error_code: 'validation_failed' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})

describe('Lawmatics 422 handling', () => {
  it('reads refused attributes from JSON:API and Rails-style bodies', async () => {
    expect(parseLawmaticsValidation({ errors: [
      { detail: 'is not included in the list', source: { pointer: '/data/attributes/marital_status' } },
      { title: 'Invalid', source: { pointer: '/data/attributes/custom_fields/0/value' } },
    ] })).toEqual({
      fields: ['marital_status', 'custom_fields'],
      details: ['marital_status: is not included in the list', 'custom_fields: Invalid'],
      customFieldIds: [],
    })
    expect(parseLawmaticsValidation({ errors: { birthdate: ['is invalid'] } }))
      .toEqual({ fields: ['birthdate'], details: ['birthdate: is invalid'], customFieldIds: [] })
    expect(parseLawmaticsValidation({ message: 'Bad request' })).toEqual({ fields: [], details: ['Bad request'], customFieldIds: [] })
  })

  async function validationError(fields: string[], details: string[] = []) {
    return new LawmaticsValidationError(fields, details)
  }

  it('retries a create once without the refused fields and reports them', async () => {
    mocks.create.mockRejectedValueOnce(await validationError(['marital_status', 'custom_fields'], ['marital_status: is not included in the list']))

    const result = await pushLeadToLawmatics(INTAKE_ID)

    expect(mocks.create).toHaveBeenCalledTimes(2)
    const retried = mocks.create.mock.calls[1][0]
    expect(retried).not.toHaveProperty('marital_status')
    expect(retried).not.toHaveProperty('custom_fields')
    expect(retried).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace', city: 'Boston' })
    expect(result.rejected).toEqual(['Marital status', 'County', 'Spouse first name', 'Children'])
    expect(result.rejectedDetails).toEqual(['marital_status: is not included in the list'])
    expect(result.sent).not.toContain('Marital status')
    expect(prospectRecord()).toMatchObject({ external_id: 'prospect-1', status: 'synced' })
  })

  it('retries an update once without the refused fields', async () => {
    await pushLeadToLawmatics(INTAKE_ID)
    db.client_intake[0].city = 'Cambridge'
    mocks.update.mockRejectedValueOnce(await validationError(['name_suffix']))

    const result = await pushLeadToLawmatics(INTAKE_ID)

    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(mocks.update.mock.calls[1][1]).not.toHaveProperty('name_suffix')
    expect(result).toMatchObject({ operation: 'updated', rejected: ['Suffix'] })
  })

  it('surfaces a refusal it cannot narrow to a field, or one naming a required field, without retrying', async () => {
    mocks.create.mockRejectedValueOnce(await validationError([], ['Something went wrong']))
    await expect(pushLeadToLawmatics(INTAKE_ID)).rejects.toMatchObject({ code: 'validation_failed', details: ['Something went wrong'] })
    expect(mocks.create).toHaveBeenCalledTimes(1)

    mocks.create.mockRejectedValueOnce(await validationError(['last_name']))
    await expect(pushLeadToLawmatics(INTAKE_ID)).rejects.toMatchObject({ code: 'validation_failed' })
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('does not retry a second time when the retry is refused too', async () => {
    mocks.create
      .mockRejectedValueOnce(await validationError(['marital_status']))
      .mockRejectedValueOnce(await validationError(['birthdate']))

    await expect(pushLeadToLawmatics(INTAKE_ID)).rejects.toMatchObject({ code: 'validation_failed', fields: ['birthdate'] })
    expect(mocks.create).toHaveBeenCalledTimes(2)
    // A refused create wrote nothing, so the next push may create again.
    expect(prospectRecord()).toMatchObject({ external_id: null, status: 'attention', last_error_code: 'validation_failed' })
  })
})

describe('Lawmatics custom field IDs', () => {
  it('accepts only numeric IDs, including a pasted merge field', async () => {
    const { normalizeLawmaticsCustomFieldId } = await import('@/lib/integrations/lawmatics/pushFields')
    expect(normalizeLawmaticsCustomFieldId('930886')).toBe('930886')
    expect(normalizeLawmaticsCustomFieldId(' custom_field_930886 ')).toBe('930886')
    expect(normalizeLawmaticsCustomFieldId('{{custom_field_930886}}')).toBe('930886')
    expect(normalizeLawmaticsCustomFieldId('practice_area')).toBeNull()
    expect(normalizeLawmaticsCustomFieldId('{{practice_area}}')).toBeNull()
    expect(normalizeLawmaticsCustomFieldId('custom_field_621073_w')).toBeNull()
  })

  it('skips and reports a mapping that is not a custom field ID instead of sending it', async () => {
    customFieldMap = { county: '{{custom_field_621072}}', lead_source: 'practice_area' }

    const result = await pushLeadToLawmatics(INTAKE_ID)

    expect(mocks.create.mock.calls[0][0].custom_fields).toEqual([{ id: '621072', value: 'Suffolk' }])
    expect(result.invalidMapping).toEqual(['Lead source'])
    expect(result.sent).toContain('County')
    expect(result.sent).not.toContain('Lead source')
  })

  it('reads a missing custom field ID from the Lawmatics message', () => {
    expect(parseLawmaticsValidation({ errors: [{ detail: "Custom Field with id 'practice_area' not found" }] })).toEqual({
      fields: ['custom_fields'],
      details: ["Custom Field with id 'practice_area' not found"],
      customFieldIds: ['practice_area'],
    })
  })

  it('drops only the custom field Lawmatics could not find, and keeps the rest', async () => {
    mocks.create.mockRejectedValueOnce(new LawmaticsValidationError(['custom_fields'],
      ["Custom Field with id '621072' not found"], ['621072']))

    const result = await pushLeadToLawmatics(INTAKE_ID)

    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[1][0].custom_fields).toEqual([
      { id: '700001', value: 'William' },
      { id: '244367', value: 'Byron King' },
    ])
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ marital_status: 'Domestic Partner' })
    expect(result.rejected).toEqual(['County'])
    expect(result.sent).toEqual(expect.arrayContaining(['Spouse first name', 'Children']))
  })
})

describe('Lawmatics picklists and actual value', () => {
  it('sends the matched practice area, source and campaign option IDs', () => {
    const { body, sentKeys, unmappedKeys } = buildLawmaticsProspectBody({
      intake: { first_name: 'Ada', last_name: 'Lovelace', practice_area: 'Estate Planning - LP', lead_source: ' Google  Ads ' },
      matterNumber: null, spouse: null, children: [], fee: 3500,
    }, {}, { practice_area: { 'EP-LP': '11' }, source: { 'google ads': '21' }, campaign: {} })

    expect(body).toEqual({
      first_name: 'Ada', last_name: 'Lovelace', practice_area_id: 11, source_id: 21, actual_value: 3500,
    })
    expect(sentKeys).toEqual(['first_name', 'last_name', 'practice_area', 'lawmatics_source', 'actual_value'])
    expect(unmappedKeys).toContain('lawmatics_campaign')
  })

  it('uses a hired matter\'s practice area and flat fee over the lead\'s', async () => {
    db.client_intake[0].practice_area = 'EP'
    db.client_intake[0].engagement_fee_quoted = 2000 as unknown as string
    db.matters = [{ id: 'matter-1', client_intake_id: INTAKE_ID, matter_number: '2026-014' }]
    db.matter_details = [{ client_id: 'matter-1', practice_area: 'Probate', flat_fee_amount: 4500 }]
    mocks.settings.mockImplementation(async () => ({ lawmaticsCustomFieldIdMap: {},
      lawmaticsOptionIdMap: { practice_area: { EP: '11', Probate: '14' }, source: {}, campaign: {} } }))

    await pushLeadToLawmatics(INTAKE_ID)

    expect(mocks.create.mock.calls[0][0]).toMatchObject({ practice_area_id: 14, actual_value: 4500, case_number: '2026-014' })
  })

  it('sends a lead\'s quoted fee as the actual value', async () => {
    db.client_intake[0].engagement_fee_quoted = 2000 as unknown as string

    await pushLeadToLawmatics(INTAKE_ID)

    expect(mocks.create.mock.calls[0][0]).toMatchObject({ actual_value: 2000 })
  })
})
