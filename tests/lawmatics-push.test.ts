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
  customFieldMap = { county: 'cf-county', spouse_first_name: 'cf-spouse-first', children: 'cf-children' }
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
    }, { county: 'cf-county', notes: 'cf-unused' })

    expect(body).toEqual({
      first_name: 'Ada', middle_name: 'King', last_name: 'Lovelace', marital_status: 'Married', case_number: '2026-014',
      custom_fields: [{ id: 'cf-county', value: 'Suffolk' }],
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
        { id: 'cf-county', value: 'Suffolk' },
        { id: 'cf-spouse-first', value: 'William' },
        { id: 'cf-children', value: 'Byron King' },
      ],
    })
    expect(first.unmapped).toEqual(['Spouse last name', 'Lead source', 'Legal plan member ID', 'Internal notes'])
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
      { id: 'cf-county', value: 'Suffolk' },
      { id: 'cf-spouse-first', value: 'William' },
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
