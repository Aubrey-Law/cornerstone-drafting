import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  config: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/integrations/statular/config', () => ({ getStatularConfig: mocks.config }))
vi.mock('@/lib/integrations/statular/client', () => ({ createStatularClient: mocks.createClient }))

import { buildStatularClientPayload } from '@/lib/integrations/statular/clientPayload'
import { syncStatularClient } from '@/lib/integrations/statular/clients'

type Row = Record<string, unknown>

let db: Record<string, Row[]>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function externalRecord(overrides: Row = {}): Row {
  return {
    id: 'record-1', provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
    external_record_type: 'client', external_id: null, status: 'pending', source_version: 'source-v1',
    idempotency_key: 'cornerstone:statular:client:lead-1:v1', request_hash: 'hash-v1',
    request_snapshot: { first_name: 'Ada', last_name: 'Lovelace' }, last_attempt_at: null,
    last_error_code: null, last_error_message: null, last_succeeded_at: null, metadata: {},
    created_at: '2026-09-16T00:00:00.000Z', updated_at: '2026-09-16T00:00:00.000Z',
    ...overrides,
  }
}

// Stateful persistence boundary. It exercises the real external-record repository,
// including duplicate claims and atomic compare-and-swap attempt predicates.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  const orders: Array<{ key: string; ascending: boolean }> = []
  let maxRows: number | undefined
  let patch: Row | undefined
  let insertion: Row | undefined
  const result = async (single: boolean) => {
    const rows = db[table] ?? []
    if (insertion) {
      const identity = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
      if (rows.some(row => identity.every(key => row[key] === insertion![key]))) return { data: null, error: null }
      const created = externalRecord({ id: `record-${rows.length + 1}`, ...insertion })
      rows.push(created)
      return { data: { ...created }, error: null }
    }
    let matches = rows.filter(row => filters.every(filter => filter(row)))
    matches = [...matches].sort((a, b) => {
      for (const order of orders) {
        const compared = String(a[order.key] ?? '').localeCompare(String(b[order.key] ?? ''))
        if (compared) return order.ascending ? compared : -compared
      }
      return 0
    })
    if (maxRows !== undefined) matches = matches.slice(0, maxRows)
    const current = matches[0]
    if (current && patch) Object.assign(current, patch)
    if (single) return { data: current ? { ...current } : null, error: null }
    return { data: matches.map(row => ({ ...row })), error: null }
  }
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    neq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] !== value); return q }),
    is: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    in: vi.fn((key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q }),
    order: vi.fn((key: string, options?: { ascending?: boolean }) => {
      orders.push({ key, ascending: options?.ascending !== false }); return q
    }),
    limit: vi.fn((value: number) => { maxRows = value; return q }),
    update: vi.fn((value: Row) => { patch = value; return q }),
    upsert: vi.fn((value: Row) => { insertion = value; return q }),
    maybeSingle: vi.fn(() => result(true)),
    then: (resolve: (value: Awaited<ReturnType<typeof result>>) => unknown) => result(false).then(resolve),
  }
  return q
}

function record(): Row | undefined {
  return db.integration_external_records[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  db = {
    client_intake: [{
      id: 'lead-1', first_name: '  Ada ', middle_name: 'M.', last_name: ' Lovelace  ',
      email: 'ada@example.test', phone: '555-1000', date_of_birth: '1815-12-10', marital_status: 'single',
      address_line1: '12 Main St', address_line2: 'Unit 4', city: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108',
      notes: 'PRIVATE-NOTES', qualification_notes: 'PRIVATE-QUALIFICATION', financial_details: { netWorth: 'PRIVATE' },
    }],
    contacts: [],
    appointments: [],
    integration_external_records: [],
  }
  mocks.from.mockImplementation(query)
  mocks.config.mockReturnValue({
    clientWebhookUrl: 'https://statular.test/client-secret',
    matterWebhookUrl: 'https://statular.test/matter-secret',
    generation: 'v1',
  })
  mocks.createClient.mockResolvedValue({ id: 'statular-client-1' })
})

describe('Statular client payload assembly', () => {
  it('emits the exact documented individual fields and omits unrelated intake data', async () => {
    await expect(buildStatularClientPayload('lead-1')).resolves.toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
      middle_name: 'M.',
      email: 'ada@example.test',
      phone: '555-1000',
      dob: '1815-12-10',
      marital_status: 'single',
      address: {
        streetAddress1: '12 Main St', streetAddress2: 'Unit 4', city: 'Boston',
        county: 'Suffolk', state: 'MA', zip: '02108',
      },
    })
  })

  it('normalizes valid source dates without changing their calendar day', async () => {
    db.client_intake[0].date_of_birth = '2000-02-29T23:59:59.000-05:00'
    db.contacts.push({
      id: 'spouse-1', client_intake_id: 'lead-1', relationship_type: 'spouse',
      first_name: 'Grace', last_name: 'Hopper', date_of_birth: '1906-12-09T00:00:00Z', created_at: '2026-01-01',
    })
    await expect(buildStatularClientPayload('lead-1')).resolves.toMatchObject({
      dob: '2000-02-29', partner_dob: '1906-12-09',
    })
  })

  it('uses the authoritative spouse contact and deterministically ordered child contacts', async () => {
    db.contacts.push(
      {
        id: 'spouse-1', client_intake_id: 'lead-1', relationship_type: 'spouse', first_name: ' Grace ',
        middle_name: 'B.', last_name: ' Hopper ', email: 'grace@example.test', phone: '555-2000',
        date_of_birth: '1906-12-09', gender: 'female', address_line1: '34 State St', address_line2: null,
        city: 'Arlington', county: 'Middlesex', state: 'MA', zip: '02474', created_at: '2026-01-01',
      },
      {
        id: 'child-b', client_intake_id: 'lead-1', relationship_type: 'child', first_name: 'Byron',
        middle_name: null, last_name: 'Lovelace', parentage: 'spouse', gender: 'male', date_of_birth: '1830-01-01',
        phone: null, email: null, deceased: true, address_line1: null, address_line2: null,
        city: null, county: null, state: null, zip: null, created_at: '2026-02-02',
      },
      {
        id: 'child-a', client_intake_id: 'lead-1', relationship_type: 'child', first_name: 'Anne',
        middle_name: 'I.', last_name: 'Lovelace', parentage: 'joint', gender: 'female', date_of_birth: '1829-01-01',
        phone: '555-3000', email: 'anne@example.test', deceased: false, address_line1: '1 Child Way', address_line2: 'Apt 2',
        city: 'Cambridge', county: 'Middlesex', state: 'MA', zip: '02139', created_at: '2026-02-01',
      },
      {
        id: 'child-c', client_intake_id: 'lead-1', relationship_type: 'child', first_name: 'Charles',
        middle_name: null, last_name: 'Lovelace', parentage: 'client', created_at: '2026-02-02',
      },
    )
    db.appointments.push({
      id: 'appointment-newer', linked_lead_id: 'lead-1', status: 'scheduled', created_at: '2026-09-16',
      second_attendee_first_name: 'Ignored', second_attendee_last_name: 'Booking', second_attendee_email: 'ignored@example.test',
      second_attendee_name: 'Ignored Booking',
    })

    await expect(buildStatularClientPayload('lead-1')).resolves.toEqual({
      first_name: 'Ada', last_name: 'Lovelace', middle_name: 'M.', email: 'ada@example.test', phone: '555-1000',
      dob: '1815-12-10', marital_status: 'single',
      address: { streetAddress1: '12 Main St', streetAddress2: 'Unit 4', city: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108' },
      partner: true, partner_first_name: 'Grace', partner_middle_name: 'B.', partner_last_name: 'Hopper',
      partner_email: 'grace@example.test', partner_phone: '555-2000', partner_dob: '1906-12-09', partner_gender: 'female',
      partner_address: { streetAddress1: '34 State St', city: 'Arlington', county: 'Middlesex', state: 'MA', zip: '02474' },
      children: [
        {
          name: 'Anne I. Lovelace', relationship: 'joint', gender: 'female', birthdate: '1829-01-01',
          phone: '555-3000', email: 'anne@example.test',
          address: { streetAddress1: '1 Child Way', streetAddress2: 'Apt 2', city: 'Cambridge', county: 'Middlesex', state: 'MA', zip: '02139' },
          deceased: false,
        },
        { name: 'Byron Lovelace', relationship: 'settlor2', gender: 'male', birthdate: '1830-01-01', deceased: true },
        { name: 'Charles Lovelace', relationship: 'settlor1' },
      ],
    })
  })

  it('uses only the newest scheduled appointment component fields when no spouse contact exists', async () => {
    db.appointments.push(
      {
        id: 'cancelled', linked_lead_id: 'lead-1', status: 'cancelled', created_at: '2026-09-20',
        second_attendee_first_name: 'Cancelled', second_attendee_last_name: 'Person', second_attendee_email: 'cancelled@example.test',
      },
      {
        id: 'older', linked_lead_id: 'lead-1', status: 'scheduled', created_at: '2026-09-10',
        second_attendee_first_name: 'Older', second_attendee_last_name: 'Person', second_attendee_email: 'older@example.test',
      },
      {
        id: 'newer', linked_lead_id: 'lead-1', status: 'scheduled', created_at: '2026-09-15',
        second_attendee_first_name: ' Jo Ann ', second_attendee_last_name: ' de la Cruz ', second_attendee_email: 'jo@example.test',
        second_attendee_name: 'WRONG DISPLAY NAME',
      },
    )
    await expect(buildStatularClientPayload('lead-1')).resolves.toMatchObject({
      partner: true, partner_first_name: 'Jo Ann', partner_last_name: 'de la Cruz', partner_email: 'jo@example.test',
    })
  })

  it('never splits a display name when explicit spouse components are absent', async () => {
    db.appointments.push({
      id: 'appointment-1', linked_lead_id: 'lead-1', status: 'scheduled', created_at: '2026-09-15',
      second_attendee_first_name: null, second_attendee_last_name: null, second_attendee_email: 'spouse@example.test',
      second_attendee_name: 'Jo Ann de la Cruz',
    })
    const payload = await buildStatularClientPayload('lead-1')
    expect(payload).not.toHaveProperty('partner')
    expect(JSON.stringify(payload)).not.toContain('Jo Ann de la Cruz')
  })

  it.each(['first_name', 'last_name'] as const)('returns a safe attention error when primary %s is missing', async field => {
    db.client_intake[0][field] = ' '
    await expect(buildStatularClientPayload('lead-1')).rejects.toMatchObject({
      name: 'IntegrationError', provider: 'statular', kind: 'attention', code: 'identity_required',
    })
  })

  it('returns a safe attention error for invalid source dates and child parentage', async () => {
    db.client_intake[0].date_of_birth = '2025-02-29'
    await expect(buildStatularClientPayload('lead-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'attention', code: 'invalid_source_data',
    })
    db.client_intake[0].date_of_birth = '2025-02-28Tnot-a-date'
    await expect(buildStatularClientPayload('lead-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'attention', code: 'invalid_source_data',
    })
    db.client_intake[0].date_of_birth = null
    db.contacts.push({
      id: 'child-1', client_intake_id: 'lead-1', relationship_type: 'child',
      first_name: 'Child', last_name: 'One', parentage: null, created_at: '2026-01-01',
    })
    await expect(buildStatularClientPayload('lead-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'attention', code: 'invalid_source_data',
    })
  })
})

describe('durable Statular client creation', () => {
  it('reuses a persisted external ID without rebuilding or calling the webhook', async () => {
    db.integration_external_records.push(externalRecord({ external_id: 'existing-client', status: 'synced' }))
    db.client_intake[0].first_name = null
    await expect(syncStatularClient('lead-1')).resolves.toEqual({
      provider: 'statular', externalRecordType: 'client', externalId: 'existing-client', operation: 'reused',
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('claims the generation-scoped frozen payload and persists the returned ID before success', async () => {
    await expect(syncStatularClient('lead-1')).resolves.toEqual({
      provider: 'statular', externalRecordType: 'client', externalId: 'statular-client-1', operation: 'created',
    })
    expect(record()).toMatchObject({
      provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1', external_record_type: 'client',
      idempotency_key: 'cornerstone:statular:client:lead-1:v1', status: 'synced', external_id: 'statular-client-1',
      request_snapshot: {
        first_name: 'Ada', last_name: 'Lovelace', middle_name: 'M.', email: 'ada@example.test', phone: '555-1000',
        dob: '1815-12-10', marital_status: 'single',
        address: { city: 'Boston', county: 'Suffolk', state: 'MA', streetAddress1: '12 Main St', streetAddress2: 'Unit 4', zip: '02108' },
      },
      request_hash: expect.stringMatching(/^[a-f0-9]{64}$/), source_version: expect.stringMatching(/^[a-f0-9]{64}$/),
      last_attempt_at: expect.any(String), last_succeeded_at: expect.any(String), last_error_code: null,
    })
  })

  it('rejects a same-key changed payload before transport and preserves the frozen row', async () => {
    const original = { first_name: 'Ada', last_name: 'Lovelace' }
    db.integration_external_records.push(externalRecord({ request_snapshot: original, request_hash: 'stored-original-hash' }))
    const before = structuredClone(record())
    await expect(syncStatularClient('lead-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'attention', code: 'idempotency_payload_conflict',
    })
    expect(record()).toEqual(before)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('sends the durable stored snapshot on a same-key/hash retry', async () => {
    const frozen = { first_name: 'Stored', last_name: 'Snapshot' }
    const currentHash = 'e6d48bf7956ed4d78f4643fbbbbaf26804680364da9ea6ea012fd76eb888a70e'
    db.integration_external_records.push(externalRecord({ request_snapshot: frozen, request_hash: currentHash, source_version: currentHash }))
    await expect(syncStatularClient('lead-1')).resolves.toMatchObject({ operation: 'created', externalId: 'statular-client-1' })
    expect(mocks.createClient).toHaveBeenCalledWith(frozen, 'cornerstone:statular:client:lead-1:v1')
    expect(record()?.request_snapshot).toEqual(frozen)
  })

  it('persists only a safe normalized failure and leaves the frozen snapshot retryable', async () => {
    const failure = new IntegrationError({
      provider: 'statular', kind: 'retryable', code: 'provider_unavailable',
      safeMessage: 'Statular is temporarily unavailable.', retryAfterMs: null,
    }, { cause: { url: 'https://statular.test/SECRET', payload: 'PRIVATE-PII' } })
    mocks.createClient.mockRejectedValueOnce(failure)
    const error = await syncStatularClient('lead-1').catch(reason => reason)
    expect(error).toMatchObject({ provider: 'statular', kind: 'retryable', code: 'provider_unavailable' })
    expect(error).not.toBe(failure)
    expect(error).not.toHaveProperty('cause')
    expect(record()).toMatchObject({
      status: 'pending', external_id: null, last_error_code: 'provider_unavailable',
      last_error_message: 'Statular is temporarily unavailable.', last_attempt_at: expect.any(String),
    })
    expect(JSON.stringify(record())).not.toContain('https://statular.test/SECRET')
    expect(JSON.stringify(record())).not.toContain('PRIVATE-PII')
  })

  it('fences concurrent attempts so a late failure cannot overwrite a peer success', async () => {
    const firstStarted = deferred<void>()
    const firstResponse = deferred<{ id: string }>()
    mocks.createClient
      .mockImplementationOnce(() => { firstStarted.resolve(); return firstResponse.promise })
      .mockResolvedValueOnce({ id: 'winner-client' })

    const first = syncStatularClient('lead-1').catch(error => error)
    await firstStarted.promise
    await expect(syncStatularClient('lead-1')).resolves.toMatchObject({ operation: 'created', externalId: 'winner-client' })
    firstResponse.reject(new IntegrationError({
      provider: 'statular', kind: 'retryable', code: 'provider_unavailable',
      safeMessage: 'Statular is temporarily unavailable.', retryAfterMs: null,
    }))

    await expect(first).resolves.toMatchObject({ code: 'integration_record_changed', kind: 'retryable' })
    expect(record()).toMatchObject({ status: 'synced', external_id: 'winner-client', last_error_code: null })
  })
})
