import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), settings: vi.fn(), scheduling: vi.fn(),
  createProspect: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), cancelEvent: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/integrations/settings', () => ({ getIntegrationSettings: mocks.settings }))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: mocks.scheduling }))
vi.mock('@/lib/integrations/lawmatics/client', () => ({
  createLawmaticsProspect: mocks.createProspect, createLawmaticsEvent: mocks.createEvent,
  updateLawmaticsEvent: mocks.updateEvent, cancelLawmaticsEvent: mocks.cancelEvent,
}))
import { createAndRecordLawmatics, resolveLawmaticsProspect } from '@/lib/integrations/lawmatics/prospect'
import type { ExternalRecord } from '@/lib/integrations/records'
import { syncLawmaticsAppointment } from '@/lib/integrations/lawmatics/appointments'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let settings: {
  lawmaticsAppointmentSyncEnabled: boolean
  lawmaticsEventTypeIdMap: Record<string, string>
  lawmaticsLocationIdMap: Record<string, string>
  lawmaticsUserIds: string[]
}
const appointment = () => db.appointments[0]
const records = () => db.integration_external_records
const record = (type: string) => records().find(row => row.external_record_type === type)!

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

// Stateful database boundary: exercise the actual shared repository, including
// ignore-duplicate upserts and conditional updates, without a remote database.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let insertion: Row | undefined
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    neq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] !== value); return q }),
    is: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    update: vi.fn((value: Row) => { patch = value; return q }),
    upsert: vi.fn((value: Row) => { insertion = value; return q }),
    maybeSingle: vi.fn(async (): Promise<{ data: Row | null; error: unknown }> => {
      const rows = db[table] ?? []
      if (insertion) {
        const keys = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
        if (rows.some(row => keys.every(key => row[key] === insertion![key]))) return { data: null, error: null }
        const created = { id: `record-${rows.length}`, external_id: null, last_attempt_at: null,
          last_succeeded_at: null, metadata: {}, ...insertion }
        rows.push(created)
        return { data: { ...created }, error: null }
      }
      const row = rows.find(candidate => filters.every(filter => filter(candidate)))
      if (row && patch) Object.assign(row, patch)
      return { data: row ? { ...row } : null, error: null }
    }),
  }
  return q
}

beforeEach(() => {
  vi.clearAllMocks()
  db = {
    appointments: [{ id: 'appointment-1', appointment_type_id: 'type-1', status: 'scheduled',
      source: 'admin', linked_lead_id: 'lead-1', linked_matter_id: null,
      start_time: '2026-09-20T14:00:00Z', end_time: '2026-09-20T15:00:00Z', location_type: 'phone',
      notes: 'PRIVATE-NOTES', manage_token_hash: 'SECRET-TOKEN', attendee_email: 'wrong@example.test' }],
    client_intake: [{ id: 'lead-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test',
      phone: '5551234567', lawmatics_matter_id: null, intake_data: 'PRIVATE-ANSWERS' }],
    matters: [{ id: 'matter-1', client_intake_id: 'lead-1' }],
    appointment_types: [{ id: 'type-1', key: 'discovery', label: 'Discovery call', location_type: 'phone' }],
    integration_external_records: [],
  }
  settings = { lawmaticsAppointmentSyncEnabled: true, lawmaticsEventTypeIdMap: { discovery: 'event-type-1' },
    lawmaticsLocationIdMap: { phone: 'location-1' }, lawmaticsUserIds: ['user-1'] }
  mocks.from.mockImplementation(query)
  mocks.settings.mockImplementation(async () => settings)
  mocks.scheduling.mockResolvedValue({ timezone: 'America/New_York' })
  mocks.createProspect.mockResolvedValue({ id: 'prospect-1', type: 'prospect' })
  mocks.createEvent.mockResolvedValue({ id: 'event-1', type: 'event' })
  mocks.updateEvent.mockResolvedValue({ id: 'event-1', type: 'event' })
  mocks.cancelEvent.mockResolvedValue(undefined)
})

describe('stable Lawmatics Prospect identity', () => {
  it('reuses a neutral Prospect mapping without an API call', async () => {
    records().push({ provider: 'lawmatics', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'prospect', external_id: 'existing-prospect', status: 'synced' })
    await expect(resolveLawmaticsProspect('appointment-1')).resolves.toBe('existing-prospect')
    expect(mocks.createProspect).not.toHaveBeenCalled()
  })

  it('reuses the legacy mapping verified against the linked intake and records neutral identity', async () => {
    db.client_intake[0].lawmatics_matter_id = 'legacy-prospect'
    await expect(resolveLawmaticsProspect('appointment-1')).resolves.toBe('legacy-prospect')
    expect(record('prospect')).toMatchObject({ external_id: 'legacy-prospect', internal_entity_id: 'lead-1', status: 'synced' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
  })

  it('creates and records one Prospect across repeat appointments linked through lead or matter', async () => {
    await resolveLawmaticsProspect('appointment-1')
    appointment().linked_lead_id = null
    appointment().linked_matter_id = 'matter-1'
    await expect(resolveLawmaticsProspect('appointment-1')).resolves.toBe('prospect-1')
    expect(mocks.createProspect).toHaveBeenCalledTimes(1)
    expect(mocks.createProspect).toHaveBeenCalledWith({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '5551234567' }, undefined)
    expect(record('prospect')).toMatchObject({ external_id: 'prospect-1', status: 'synced' })
  })

  it('does not resolve identity by matching attendee email', async () => {
    appointment().linked_lead_id = null
    appointment().attendee_email = 'ada@example.test'
    await expect(resolveLawmaticsProspect('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'identity_required' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
  })

  it('rejects conflicting lead and matter identities', async () => {
    appointment().linked_matter_id = 'matter-1'
    db.matters[0].client_intake_id = 'different-lead'
    await expect(resolveLawmaticsProspect('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'identity_conflict' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
  })

  it('requires explicit name components before creating a Prospect', async () => {
    db.client_intake[0].last_name = null
    await expect(resolveLawmaticsProspect('appointment-1')).rejects.toMatchObject({ code: 'identity_required' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
  })

  it('allows only one provider create during concurrent Prospect resolution', async () => {
    const results = await Promise.allSettled([resolveLawmaticsProspect('appointment-1'), resolveLawmaticsProspect('appointment-1')])
    expect(results.some(result => result.status === 'fulfilled')).toBe(true)
    expect(mocks.createProspect).toHaveBeenCalledTimes(1)
  })

  it('rejects a late claim that observed another worker already sending the POST', async () => {
    const claimed = { provider: 'lawmatics', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'prospect', external_id: null, status: 'pending', idempotency_key: 'same-key',
      last_attempt_at: '2026-09-15T00:00:00Z', last_error_code: null } as ExternalRecord
    records().push(claimed)
    await expect(createAndRecordLawmatics({ provider: 'lawmatics', internalEntityType: 'lead', internalEntityId: 'lead-1', externalRecordType: 'prospect' },
      claimed, mocks.createProspect)).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
  })

  it('does not duplicate a Prospect after an ambiguous create response', async () => {
    mocks.createProspect.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'attention',
      code: 'invalid_record', safeMessage: 'Invalid record.', retryAfterMs: null }))
    await expect(resolveLawmaticsProspect('appointment-1')).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    await expect(resolveLawmaticsProspect('appointment-1')).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    expect(mocks.createProspect).toHaveBeenCalledTimes(1)
  })
})

describe('Lawmatics Event convergence', () => {
  it.each(['success', 'newer-attempt'])('does not overwrite a concurrent %s while marking stale ambiguity', async concurrent => {
    const abandoned = { provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
      external_record_type: 'event', external_id: null, status: 'pending', source_version: 'abandoned-version',
      idempotency_key: 'abandoned-key', request_snapshot: { evidence: 'original' }, request_hash: 'original-hash',
      last_attempt_at: new Date(Date.now() - 121_000).toISOString(), last_error_code: null }
    records().push({ ...abandoned })
    mocks.from.mockImplementation((table: string) => {
      const q = query(table)
      const update = q.update.getMockImplementation()!
      q.update.mockImplementation((patch: Row) => {
        if (patch.last_error_code === 'create_outcome_unknown') {
          if (concurrent === 'success') Object.assign(record('event'), { status: 'synced', external_id: 'winner-event' })
          else record('event').last_attempt_at = new Date().toISOString()
        }
        return update(patch)
      })
      return q
    })
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ kind: 'retryable', code: 'integration_record_changed' })
    expect(record('event').status).toBe(concurrent === 'success' ? 'synced' : 'pending')
    expect(record('event').last_error_code).toBeNull()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it.each(['prospect', 'event'])('persists stale %s create ambiguity without replacing its attempt evidence', async type => {
    const abandoned = { provider: 'lawmatics', internal_entity_type: type === 'event' ? 'appointment' : 'lead',
      internal_entity_id: type === 'event' ? 'appointment-1' : 'lead-1', external_record_type: type,
      external_id: null, status: 'pending', source_version: 'abandoned-version', idempotency_key: 'abandoned-key',
      request_snapshot: { evidence: 'original' }, request_hash: 'original-hash',
      last_attempt_at: new Date(Date.now() - 121_000).toISOString(), last_error_code: null }
    records().push({ ...abandoned })
    const service = type === 'event' ? syncLawmaticsAppointment : resolveLawmaticsProspect
    await expect(service('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'create_outcome_unknown' })
    expect(record(type)).toMatchObject({ ...abandoned, status: 'attention', last_error_code: 'create_outcome_unknown' })
    const saved = structuredClone(record(type))
    await expect(service('appointment-1')).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    expect(record(type)).toEqual(saved)
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it.each(['create', 'update'])('does not %s an Event if sync is disabled while its Prospect POST is pending', async operation => {
    if (operation === 'update') {
      await syncLawmaticsAppointment('appointment-1')
      records().splice(records().findIndex(row => row.external_record_type === 'prospect'), 1)
      appointment().start_time = '2026-09-21T14:00:00Z'
      mocks.createEvent.mockClear()
    }
    const started = deferred<void>()
    const response = deferred<{ id: string }>()
    mocks.createProspect.mockImplementationOnce(() => { started.resolve(); return response.promise })
    const pending = syncLawmaticsAppointment('appointment-1').catch(error => error)
    await started.promise
    settings.lawmaticsAppointmentSyncEnabled = false
    response.resolve({ id: 'prospect-late' })
    expect(await pending).toMatchObject({ code: 'integration_disabled' })
    expect(mocks.createEvent).not.toHaveBeenCalled()
    expect(mocks.updateEvent).not.toHaveBeenCalled()
    expect(record('prospect')).toMatchObject({ external_id: 'prospect-late', status: 'synced' })
  })

  it('rechecks disablement immediately before cancelling the provider Event', async () => {
    await syncLawmaticsAppointment('appointment-1')
    appointment().status = 'cancelled'
    mocks.from.mockImplementation((table: string) => {
      const q = query(table)
      const update = q.update.getMockImplementation()!
      q.update.mockImplementation((patch: Row) => {
        if (table === 'integration_external_records' && patch.last_attempt_at && patch.status === 'pending') {
          settings.lawmaticsAppointmentSyncEnabled = false
        }
        return update(patch)
      })
      return q
    })
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ code: 'integration_disabled' })
    expect(mocks.cancelEvent).not.toHaveBeenCalled()
  })

  it.each(['prospect', 'event'] as const)('blocks a third caller during a retried %s POST and lets the retry finish', async type => {
    const provider = type === 'prospect' ? mocks.createProspect : mocks.createEvent
    const service = type === 'prospect' ? resolveLawmaticsProspect : syncLawmaticsAppointment
    const thirdAppointmentId = type === 'prospect' ? 'appointment-2' : 'appointment-1'
    db.appointments.push({ ...appointment(), id: 'appointment-2', linked_lead_id: null, linked_matter_id: 'matter-1' })
    provider.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'retryable', code: 'rate_limited',
      safeMessage: 'Rate limited.', retryAfterMs: 7000 }))
    await expect(service('appointment-1')).rejects.toMatchObject({ code: 'rate_limited' })
    expect(record(type)).toMatchObject({ external_id: null, last_error_code: 'rate_limited' })
    const firstAttemptAt = record(type).last_attempt_at

    const entered = deferred<void>()
    const response = deferred<{ id: string; type: string }>()
    provider.mockImplementationOnce(() => { entered.resolve(); return response.promise })
    // Attach rejection handling before releasing the provider; the RED case must
    // finish cleanly even when the third caller steals this retry's fence.
    const retry = Promise.allSettled([service('appointment-1')])
    await entered.promise
    expect(provider).toHaveBeenCalledTimes(2)
    expect(record(type).last_attempt_at).not.toBe(firstAttemptAt)
    const retryAttemptAt = record(type).last_attempt_at
    try {
      const [third] = await Promise.allSettled([service(thirdAppointmentId)])
      expect(provider).toHaveBeenCalledTimes(2)
      expect(third).toMatchObject({ status: 'rejected', reason: { kind: 'retryable', code: 'integration_busy' } })
      expect(record(type)).toMatchObject({ status: 'pending', external_id: null,
        last_attempt_at: retryAttemptAt, last_error_code: null, last_error_message: null })
    } finally {
      response.resolve({ id: `${type}-1`, type })
      await retry
    }
    const [completed] = await retry
    expect(completed).toMatchObject({ status: 'fulfilled' })
    expect(record(type)).toMatchObject({ status: 'synced', external_id: `${type}-1`, last_attempt_at: retryAttemptAt })
    await service(thirdAppointmentId)
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('creates and records one scheduled Event with only safe appointment information', async () => {
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'created', externalId: 'event-1' })
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-09-20T14:00:00Z', end: '2026-09-20T15:00:00Z',
      timezone: 'America/New_York', prospectId: 'prospect-1', eventTypeId: 'event-type-1', locationId: 'location-1', userIds: ['user-1'] }), undefined)
    expect(record('event')).toMatchObject({ external_id: 'event-1', status: 'synced', source_version: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const sent = JSON.stringify(mocks.createEvent.mock.calls)
    for (const secret of ['PRIVATE-NOTES', 'SECRET-TOKEN', 'PRIVATE-ANSWERS']) expect(sent).not.toContain(secret)
    expect(sent).toContain('appointment-1')
  })

  it('reuses an unchanged Event without a provider call', async () => {
    await syncLawmaticsAppointment('appointment-1')
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'reused', externalId: 'event-1' })
    expect(mocks.createEvent).toHaveBeenCalledTimes(1)
    expect(mocks.updateEvent).not.toHaveBeenCalled()
  })

  it.each(['start_time', 'end_time', 'status', 'location_type'])( 'converges a changed %s on the existing Event', async field => {
    await syncLawmaticsAppointment('appointment-1')
    const before = record('event').source_version
    appointment()[field] = ({ start_time: '2026-09-21T14:00:00Z', end_time: '2026-09-21T15:00:00Z', status: 'no_show', location_type: 'teams' })[field]
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'updated' })
    expect(mocks.updateEvent).toHaveBeenCalledWith('event-1', expect.any(Object), undefined)
    expect(record('event').source_version).not.toBe(before)
    expect(mocks.createEvent).toHaveBeenCalledTimes(1)
  })

  it.each(['eventType', 'location', 'users', 'timezone'])( 'converges corrected %s configuration', async mapping => {
    await syncLawmaticsAppointment('appointment-1')
    const before = record('event').source_version
    if (mapping === 'eventType') settings.lawmaticsEventTypeIdMap.discovery = 'corrected-type'
    if (mapping === 'location') delete settings.lawmaticsLocationIdMap.phone
    if (mapping === 'users') settings.lawmaticsUserIds = ['corrected-user']
    if (mapping === 'timezone') mocks.scheduling.mockResolvedValue({ timezone: 'UTC' })
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'updated' })
    expect(record('event').source_version).not.toBe(before)
  })

  it('converges a corrected neutral Prospect mapping on the existing Event', async () => {
    await syncLawmaticsAppointment('appointment-1')
    record('prospect').external_id = 'corrected-prospect'
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'updated' })
    expect(mocks.updateEvent).toHaveBeenCalledWith('event-1', expect.objectContaining({ prospectId: 'corrected-prospect' }), undefined)
  })

  it('reuses the Event when configured users are only reordered', async () => {
    settings.lawmaticsUserIds = ['user-1', 'user-2']
    await syncLawmaticsAppointment('appointment-1')
    settings.lawmaticsUserIds = ['user-2', 'user-1']
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'reused' })
    expect(mocks.updateEvent).not.toHaveBeenCalled()
  })

  it('deletes an existing cancelled Event and durably records cancellation once', async () => {
    await syncLawmaticsAppointment('appointment-1')
    appointment().status = 'cancelled'
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'cancelled', externalId: 'event-1' })
    expect(mocks.cancelEvent).toHaveBeenCalledWith('event-1', undefined)
    expect(record('event')).toMatchObject({ status: 'synced', metadata: { operation: 'cancelled' } })
    await syncLawmaticsAppointment('appointment-1')
    expect(mocks.cancelEvent).toHaveBeenCalledTimes(1)
  })

  it('marks cancellation without creating a Prospect or Event, even when mappings are missing', async () => {
    appointment().status = 'cancelled'
    settings.lawmaticsEventTypeIdMap = {}
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'cancelled', externalId: '' })
    expect(record('event')).toMatchObject({ status: 'synced', external_id: null, metadata: { operation: 'cancelled' } })
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('can schedule and then cancel an appointment that was initially cancelled without an Event', async () => {
    appointment().status = 'cancelled'
    await syncLawmaticsAppointment('appointment-1')
    appointment().status = 'scheduled'
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'created' })
    appointment().status = 'cancelled'
    await syncLawmaticsAppointment('appointment-1')
    expect(mocks.cancelEvent).toHaveBeenCalledWith('event-1', undefined)
  })

  it('requires an appointment type mapping before calling the provider', async () => {
    settings.lawmaticsEventTypeIdMap = {}
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'configuration_required' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it.each([resolveLawmaticsProspect, syncLawmaticsAppointment])('rejects Calendly without a provider call', async service => {
    appointment().source = 'calendly'
    await expect(service('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'unsupported_source' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('honors the disabled integration without a provider call', async () => {
    settings.lawmaticsAppointmentSyncEnabled = false
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ code: 'integration_disabled' })
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('allows only one Event POST across concurrent synchronization', async () => {
    db.client_intake[0].lawmatics_matter_id = 'legacy-prospect'
    await resolveLawmaticsProspect('appointment-1')
    await Promise.allSettled([syncLawmaticsAppointment('appointment-1'), syncLawmaticsAppointment('appointment-1')])
    expect(mocks.createEvent).toHaveBeenCalledTimes(1)
  })

  it('retries an explicitly rejected rate-limited Event create and preserves Retry-After', async () => {
    mocks.createEvent.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'retryable', code: 'rate_limited',
      safeMessage: 'Rate limited.', retryAfterMs: 7000 }))
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 7000 })
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'created' })
    expect(mocks.createEvent).toHaveBeenCalledTimes(2)
  })

  it('retries a conclusively rejected create after correcting its provider mapping', async () => {
    mocks.createEvent.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'attention', code: 'validation_failed',
      safeMessage: 'Rejected.', retryAfterMs: null }))
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ code: 'validation_failed' })
    settings.lawmaticsEventTypeIdMap.discovery = 'corrected-type'
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'created' })
    expect(mocks.createEvent).toHaveBeenLastCalledWith(expect.objectContaining({ eventTypeId: 'corrected-type' }), undefined)
  })

  it('treats an already-removed Event as successfully cancelled', async () => {
    await syncLawmaticsAppointment('appointment-1')
    appointment().status = 'cancelled'
    mocks.cancelEvent.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'attention', code: 'not_found',
      safeMessage: 'Missing.', retryAfterMs: null }))
    await expect(syncLawmaticsAppointment('appointment-1')).resolves.toMatchObject({ operation: 'cancelled' })
    expect(record('event')).toMatchObject({ status: 'synced', metadata: { operation: 'cancelled' } })
  })

  it('does not create a second Event when saving the returned identity fails', async () => {
    let failIdentitySave = true
    mocks.from.mockImplementation((table: string) => {
      const q = query(table)
      const original = q.update.getMockImplementation()!
      q.update.mockImplementation((patch: Row) => {
        original(patch)
        if (table === 'integration_external_records' && patch.external_id === 'event-1' && failIdentitySave) {
          failIdentitySave = false
          q.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE-DATABASE-ERROR' } })
        }
        return q
      })
      return q
    })
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ code: 'create_outcome_unknown' })
    expect(mocks.createEvent).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(record('event'))).not.toContain('PRIVATE-DATABASE-ERROR')
  })

  it.each(['network_error', 'timeout', 'provider_unavailable', 'invalid_response', 'invalid_record'])('does not repeat an ambiguous %s create after a source change', async code => {
    mocks.createEvent.mockRejectedValueOnce(new IntegrationError({ provider: 'lawmatics', kind: 'retryable', code,
      safeMessage: 'Provider failed.', retryAfterMs: null }))
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'create_outcome_unknown' })
    appointment().start_time = '2026-09-21T14:00:00Z'
    await expect(syncLawmaticsAppointment('appointment-1')).rejects.toMatchObject({ kind: 'attention', code: 'create_outcome_unknown' })
    expect(mocks.createEvent).toHaveBeenCalledTimes(1)
    expect(record('event')).toMatchObject({ status: 'attention', last_error_code: 'create_outcome_unknown' })
  })
})
