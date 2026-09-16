import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getIntegrationSettings, updateIntegrationSettings, sanitizeProviderIdMap, sanitizeDocIdMap, sanitizeProviderIds } from '@/lib/integrations/settings'
import { beginCreateIntegrationAttempt, beginIntegrationAttempt, claimExternalRecord, getExternalRecord, recordIntegrationCancellation, recordIntegrationDisabled, recordIntegrationFailure, recordIntegrationSuccess } from '@/lib/integrations/records'
import { IntegrationError } from '@/lib/integrations/errors'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from }) }))

// Capture the actual persistence boundary, with independent responses per query.
function query(data: unknown = null, error: unknown = null) {
  const result = { data, error }
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  from.mockReturnValueOnce(builder)
  return builder
}

// Evaluate UPDATE predicates against the row at execution time, as PostgREST
// does in one SQL statement. A failed predicate returns no updated row.
function atomicQuery(store: { value: Record<string, unknown> }) {
  const builder = query()
  const predicates: Array<(value: Record<string, unknown>) => boolean> = []
  let patch: Record<string, unknown> = {}
  builder.eq.mockImplementation((column: string, value: unknown) => {
    predicates.push(current => current[column] === value)
    return builder
  })
  builder.neq.mockImplementation((column: string, value: unknown) => {
    predicates.push(current => current[column] !== value)
    return builder
  })
  builder.is.mockImplementation((column: string, value: unknown) => {
    predicates.push(current => current[column] === value)
    return builder
  })
  builder.update.mockImplementation((value: Record<string, unknown>) => {
    patch = value
    return builder
  })
  builder.maybeSingle.mockImplementation(async () => {
    if (!predicates.every(matches => matches(store.value))) return { data: null, error: null }
    store.value = { ...store.value, ...patch }
    return { data: { ...store.value }, error: null }
  })
  return builder
}

const ref = { provider: 'statular' as const, internalEntityType: 'matter' as const, internalEntityId: 'matter-1', externalRecordType: 'matter' as const }
const claim = { ...ref, sourceVersion: 'v1', idempotencyKey: 'matter-1:v1', requestHash: 'hash-1', requestSnapshot: { private: 'SNAPSHOT_SECRET' } }
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1', provider: 'statular', internal_entity_type: 'matter', internal_entity_id: 'matter-1', external_record_type: 'matter',
    external_id: null, status: 'pending', source_version: 'v1', idempotency_key: 'matter-1:v1', request_hash: 'hash-1',
    request_snapshot: { private: 'SNAPSHOT_SECRET' }, last_error_code: null, last_error_message: null,
    last_attempt_at: null, last_succeeded_at: null, metadata: {}, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z', ...overrides,
  }
}

beforeEach(() => { vi.clearAllMocks(); from.mockReset() })

describe('integration settings', () => {
  it('reads only the singleton and defaults both connectors to disabled when absent', async () => {
    const read = query()
    expect(await getIntegrationSettings()).toMatchObject({ lawmaticsAppointmentSyncEnabled: false, statularSyncEnabled: false, lawmaticsEventTypeIdMap: {}, statularDocIdMap: {} })
    expect(from).toHaveBeenCalledWith('integration_settings')
    expect(read.eq).toHaveBeenCalledWith('id', 1)
    expect(read.upsert).not.toHaveBeenCalled()
  })

  it('maps saved settings without sharing provider enablement', async () => {
    query({ lawmatics_appointment_sync_enabled: true, statular_sync_enabled: false, lawmatics_event_type_id_map: { consult: ' 12 ' }, lawmatics_location_id_map: {}, lawmatics_user_ids: [' 7 '], statular_doc_id_map: { 'EP:joint_trust': 4 }, statular_drafter_id: 'drafter', lawmatics_last_checked_at: null, lawmatics_last_check_error: null })
    expect(await getIntegrationSettings()).toMatchObject({ lawmaticsAppointmentSyncEnabled: true, statularSyncEnabled: false, lawmaticsEventTypeIdMap: { consult: '12' }, lawmaticsUserIds: ['7'], statularDocIdMap: { 'EP:joint_trust': 4 }, statularDrafterId: 'drafter' })
  })

  it('normalizes string provider IDs and accepts positive document IDs', () => {
    expect(sanitizeProviderIdMap({ consult: ' 123 ' })).toEqual({ consult: '123' })
    expect(sanitizeProviderIds([' 7 ', '8'])).toEqual(['7', '8'])
    expect(sanitizeDocIdMap({ 'EP:joint_trust': 4 })).toEqual({ 'EP:joint_trust': 4 })
  })

  it.each([0, -1, 1.2, '4', null, Number.MAX_SAFE_INTEGER + 1])('rejects invalid Statular doc ID %s', value => {
    expect(() => sanitizeDocIdMap({ 'EP:joint_trust': value })).toThrow('positive integer')
  })

  it.each([null, [], 'map', { '': '1' }, { ' key ': '1' }, { key: '' }, { key: 4 }])('rejects malformed provider maps %#', value => {
    expect(() => sanitizeProviderIdMap(value)).toThrow()
  })

  it.each([null, [], { '': 4 }, { ' key ': 4 }])('rejects malformed document maps %#', value => {
    expect(() => sanitizeDocIdMap(value)).toThrow()
  })

  it.each([null, {}, [''], [1]])('rejects malformed user ID lists %#', value => {
    expect(() => sanitizeProviderIds(value)).toThrow()
  })

  it('updates the singleton with validated fields and actor while omitting unspecified settings', async () => {
    const write = query()
    await updateIntegrationSettings({ statularSyncEnabled: true, statularDocIdMap: { 'EP:joint_trust': 4 }, statularDrafterId: ' 9 ', lawmaticsUserIds: [' 7 '] }, 'actor-1')
    expect(write.upsert).toHaveBeenCalledWith({ id: 1, updated_by: 'actor-1', updated_at: expect.any(String), statular_sync_enabled: true, statular_doc_id_map: { 'EP:joint_trust': 4 }, statular_drafter_id: '9', lawmatics_user_ids: ['7'] }, { onConflict: 'id' })
  })

  it.each([null, [], { token: 'secret' }, { id: 2 }, { lawmaticsLastCheckError: 'raw body' }, { statularSyncEnabled: 'true' }, { lawmaticsAppointmentSyncEnabled: 1 }, { statularDrafterId: ' ' }])('rejects invalid settings before accessing persistence %#', async value => {
    await expect(updateIntegrationSettings(value, 'actor-1')).rejects.toThrow()
    expect(from).not.toHaveBeenCalled()
  })

  it('allows explicitly clearing the optional drafter ID', async () => {
    const write = query()
    await updateIntegrationSettings({ statularDrafterId: null }, 'actor-1')
    expect(write.upsert.mock.calls[0][0]).toMatchObject({ statular_drafter_id: null })
  })

  it('does not expose database errors in read or write failures', async () => {
    query(null, { message: 'RAW_DATABASE_SECRET' })
    await expect(getIntegrationSettings()).rejects.toThrow('Unable to read integration settings.')
    query(null, { message: 'RAW_DATABASE_SECRET' })
    await expect(updateIntegrationSettings({}, 'actor-1')).rejects.toThrow('Unable to save integration settings.')
  })
})

describe('external records', () => {
  it.each([true, false])('completes disabled with all evidence preserved and optional attempt fencing=%s', async fenced => {
    const attemptAt = '2026-09-15T12:00:00Z'
    const before = row({ external_id: 'existing-remote', last_attempt_at: attemptAt,
      last_error_code: 'old-error', last_error_message: 'Old safe error.',
      last_succeeded_at: '2026-09-14T12:00:00Z', metadata: { evidence: 'original' } })
    const store = { value: before }
    atomicQuery(store)
    await recordIntegrationDisabled({ ...ref, idempotencyKey: 'matter-1:v1', ...(fenced ? { attemptAt } : {}) })
    expect(store.value).toEqual({ ...before, status: 'disabled', last_error_code: null, last_error_message: null })
  })

  it.each([
    { status: 'synced', external_id: 'winner' },
    { idempotency_key: 'new-key' },
    { last_attempt_at: '2026-09-15T12:00:01Z' },
    { internal_entity_id: 'other-matter' },
    { external_record_type: 'client' },
    { internal_entity_type: 'lead' },
    { provider: 'lawmatics' },
  ])('does not disable a stale, different, or synced delivery: %j', async difference => {
    const before = row({ last_attempt_at: '2026-09-15T12:00:00Z', ...difference })
    const store = { value: before }
    atomicQuery(store)
    await expect(recordIntegrationDisabled({ ...ref, idempotencyKey: 'matter-1:v1', attemptAt: '2026-09-15T12:00:00Z' }))
      .rejects.toMatchObject({ kind: 'retryable', code: 'integration_record_changed' })
    expect(store.value).toEqual(before)
  })

  it('normalizes database failure while recording a disabled delivery', async () => {
    query(null, { message: 'PRIVATE-SNAPSHOT-TOKEN' })
    await expect(recordIntegrationDisabled({ ...ref, idempotencyKey: 'matter-1:v1' }))
      .rejects.toMatchObject({ code: 'integration_persistence_failed', message: 'Unable to persist or read integration record.' })
  })

  it('fences concurrent attempts so only one caller wins the same prior timestamp', async () => {
    const store = { value: row() }
    const first = atomicQuery(store)
    atomicQuery(store)
    const results = await Promise.allSettled([0, 1].map(() => beginIntegrationAttempt({ ...ref, idempotencyKey: 'matter-1:v1', expectedLastAttemptAt: null })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(first.eq.mock.calls).toEqual([['provider', 'statular'], ['internal_entity_type', 'matter'], ['internal_entity_id', 'matter-1'], ['external_record_type', 'matter'], ['idempotency_key', 'matter-1:v1']])
    expect(first.is).toHaveBeenCalledWith('last_attempt_at', null)
  })

  it('allows a new retry with a fresh timestamp even within the same millisecond', async () => {
    const now = new Date().toISOString()
    const store = { value: row({ last_attempt_at: now }) }
    atomicQuery(store)
    const result = await beginIntegrationAttempt({ ...ref, idempotencyKey: 'matter-1:v1', expectedLastAttemptAt: now })
    expect(Date.parse(result.last_attempt_at!)).toBeGreaterThan(Date.parse(now))
  })

  it('atomically consumes the prior rejection when acquiring a retry attempt', async () => {
    const before = '2026-09-15T12:00:00.000Z'
    const store = { value: row({ status: 'attention', last_attempt_at: before,
      last_error_code: 'validation_failed', last_error_message: 'Rejected.' }) }
    const write = atomicQuery(store)
    const acquired = await beginIntegrationAttempt({ ...ref, idempotencyKey: 'matter-1:v1', expectedLastAttemptAt: before })
    expect(acquired).toMatchObject({ status: 'pending', last_error_code: null, last_error_message: null })
    expect(write.update).toHaveBeenCalledExactlyOnceWith({ last_attempt_at: acquired.last_attempt_at,
      status: 'pending', last_error_code: null, last_error_message: null })
    expect(Date.parse(acquired.last_attempt_at!)).toBeGreaterThan(Date.parse(before))
    expect(store.value).toMatchObject({ status: 'pending', last_attempt_at: acquired.last_attempt_at,
      last_error_code: null, last_error_message: null })
  })

  it('does not reopen a create-only record after a concurrent success', async () => {
    const before = row({ status: 'synced', external_id: 'winner', last_attempt_at: '2026-09-15T12:00:00.000Z' })
    const store = { value: before }
    const write = atomicQuery(store)
    await expect(beginCreateIntegrationAttempt({
      ...ref, idempotencyKey: 'matter-1:v1', expectedLastAttemptAt: '2026-09-15T12:00:00.000Z',
    })).rejects.toMatchObject({ code: 'integration_record_changed', kind: 'retryable' })
    expect(store.value).toEqual(before)
    expect(write.is).toHaveBeenCalledWith('external_id', null)
    expect(write.neq).toHaveBeenCalledWith('status', 'synced')
  })

  it.each(['success', 'failure', 'cancellation'])('rejects stale %s completion for a superseded attempt', async operation => {
    const store = { value: row({ last_attempt_at: '2026-09-15T12:00:01Z' }) }
    const before = { ...store.value }
    atomicQuery(store)
    const input = { ...ref, idempotencyKey: 'matter-1:v1', attemptAt: '2026-09-15T12:00:00Z' }
    const error = new IntegrationError({ provider: 'statular', kind: 'attention', code: 'failed', safeMessage: 'Failed.', retryAfterMs: null })
    const result = operation === 'success' ? recordIntegrationSuccess({ ...input, externalId: 'remote-1' })
      : operation === 'failure' ? recordIntegrationFailure({ ...input, error }) : recordIntegrationCancellation(input)
    await expect(result).rejects.toMatchObject({ code: 'integration_record_changed' })
    expect(store.value).toEqual(before)
  })

  it('preserves the fence timestamp on completion even when the clock moves backward', async () => {
    const attemptAt = '2099-09-15T12:00:00.000Z'
    const store = { value: row({ last_attempt_at: attemptAt }) }
    atomicQuery(store)
    await recordIntegrationSuccess({ ...ref, idempotencyKey: 'matter-1:v1', attemptAt, externalId: 'remote-1' })
    expect(store.value.last_attempt_at).toBe(attemptAt)
  })

  it.each([null, 'remote-1'])('completes cancellation while preserving external ID %s', async externalId => {
    const store = { value: row({ external_id: externalId, last_attempt_at: '2026-09-15T12:00:00Z' }) }
    atomicQuery(store)
    await recordIntegrationCancellation({ ...ref, idempotencyKey: 'matter-1:v1', attemptAt: '2026-09-15T12:00:00Z' })
    expect(store.value).toMatchObject({ external_id: externalId, status: 'synced', metadata: { operation: 'cancelled' },
      last_error_code: null, last_error_message: null, last_succeeded_at: expect.any(String) })
  })

  it('reads by all four identity columns', async () => {
    const read = query(row())
    expect(await getExternalRecord(ref)).toMatchObject({ id: 'record-1' })
    expect(read.eq.mock.calls).toEqual([['provider', 'statular'], ['internal_entity_type', 'matter'], ['internal_entity_id', 'matter-1'], ['external_record_type', 'matter']])
  })

  it('returns null for a missing external record', async () => {
    query()
    expect(await getExternalRecord(ref)).toBeNull()
  })

  it('creates a frozen claim using the four-column conflict key without overwriting a concurrent claim', async () => {
    const insert = query(row())
    expect(await claimExternalRecord(claim)).toMatchObject({ idempotency_key: 'matter-1:v1', request_hash: 'hash-1' })
    expect(insert.upsert).toHaveBeenCalledWith(expect.objectContaining({ provider: 'statular', internal_entity_type: 'matter', internal_entity_id: 'matter-1', external_record_type: 'matter', source_version: 'v1', idempotency_key: 'matter-1:v1', request_hash: 'hash-1', request_snapshot: { private: 'SNAPSHOT_SECRET' } }), { onConflict: 'provider,internal_entity_type,internal_entity_id,external_record_type', ignoreDuplicates: true })
  })

  it('reuses a synced same-key claim, preserving its external ID and frozen snapshot', async () => {
    query()
    query(row({ status: 'synced', external_id: 'remote-1' }))
    expect(await claimExternalRecord({ ...claim, requestSnapshot: { ignored: true } })).toMatchObject({ status: 'synced', external_id: 'remote-1', request_snapshot: { private: 'SNAPSHOT_SECRET' } })
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('rejects a different request hash under the same idempotency key', async () => {
    query()
    query(row())
    await expect(claimExternalRecord({ ...claim, requestHash: 'other-hash' })).rejects.toMatchObject({ name: 'IntegrationError', code: 'idempotency_payload_conflict', kind: 'attention' })
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('claims a new version without resetting an existing external ID', async () => {
    query()
    query(row({ status: 'synced', external_id: 'remote-1' }))
    const store = { value: row({ status: 'synced', external_id: 'remote-1' }) }
    const write = atomicQuery(store)
    expect(await claimExternalRecord({ ...claim, sourceVersion: 'v2', idempotencyKey: 'matter-1:v2', requestHash: 'hash-2' })).toMatchObject({ external_id: 'remote-1', status: 'pending' })
    expect(write.update.mock.calls[0][0]).not.toHaveProperty('external_id')
    expect(write.eq.mock.calls).toEqual([['provider', 'statular'], ['internal_entity_type', 'matter'], ['internal_entity_id', 'matter-1'], ['external_record_type', 'matter'], ['idempotency_key', 'matter-1:v1'], ['request_hash', 'hash-1']])
    expect(store.value).toMatchObject({ external_id: 'remote-1', status: 'pending', source_version: 'v2', idempotency_key: 'matter-1:v2', request_hash: 'hash-2' })
  })

  it('claims a previously unhashed row using an IS NULL predicate', async () => {
    query()
    query(row({ request_hash: null }))
    const store = { value: row({ request_hash: null }) }
    const write = atomicQuery(store)
    await claimExternalRecord({ ...claim, sourceVersion: 'v2', idempotencyKey: 'matter-1:v2', requestHash: 'hash-2' })
    expect(write.is.mock.calls).toEqual([['request_hash', null]])
    expect(write.eq.mock.calls).toEqual([['provider', 'statular'], ['internal_entity_type', 'matter'], ['internal_entity_id', 'matter-1'], ['external_record_type', 'matter'], ['idempotency_key', 'matter-1:v1']])
    expect(store.value).toMatchObject({ idempotency_key: 'matter-1:v2', request_hash: 'hash-2' })
  })

  it.each([
    { idempotency_key: 'concurrent-key' },
    { request_hash: 'concurrent-hash' },
  ])('rejects a claim if its prior delivery changed before the atomic update: %j', async concurrentChange => {
    query()
    query(row())
    const before = row(concurrentChange)
    const store = { value: before }
    atomicQuery(store)
    await expect(claimExternalRecord({ ...claim, sourceVersion: 'v2', idempotencyKey: 'matter-1:v2', requestHash: 'hash-2' })).rejects.toMatchObject({ code: 'integration_record_changed', kind: 'retryable' })
    expect(store.value).toEqual(before)
  })

  it.each(['attention', 'retryable'] as const)('persists only normalized %s failure fields', async kind => {
    const store = { value: row() }
    const write = atomicQuery(store)
    const error = new IntegrationError({ provider: 'statular', kind, code: 'validation_failed', safeMessage: 'Statular rejected the client fields.', retryAfterMs: null }, { cause: { body: 'RAW_PROVIDER_SECRET', request_snapshot: 'SNAPSHOT_SECRET' } })
    await recordIntegrationFailure({ ...ref, idempotencyKey: 'matter-1:v1', error })
    expect(write.update).toHaveBeenCalledWith({ status: kind === 'attention' ? 'attention' : 'pending', last_error_code: 'validation_failed', last_error_message: 'Statular rejected the client fields.', last_attempt_at: expect.any(String) })
    expect(write.eq).toHaveBeenCalledWith('idempotency_key', 'matter-1:v1')
    expect(JSON.stringify(write.update.mock.calls)).not.toMatch(/SECRET|request_snapshot|cause/)
    expect(store.value).toMatchObject({ status: kind === 'attention' ? 'attention' : 'pending', last_error_code: 'validation_failed', last_error_message: 'Statular rejected the client fields.' })
  })

  it.each(['attention', 'retryable'] as const)('preserves success when a late same-key %s failure arrives', async kind => {
    const store = { value: row() }
    atomicQuery(store)
    await recordIntegrationSuccess({ ...ref, idempotencyKey: 'matter-1:v1', externalId: 'remote-1' })
    const synced = { ...store.value }
    const write = atomicQuery(store)
    const error = new IntegrationError({ provider: 'statular', kind, code: 'concurrent_attempt_failed', safeMessage: 'Concurrent delivery failed.', retryAfterMs: null })
    await expect(recordIntegrationFailure({ ...ref, idempotencyKey: 'matter-1:v1', error })).rejects.toMatchObject({ code: 'integration_record_changed' })
    expect(store.value).toEqual(synced)
    expect(store.value).toMatchObject({ status: 'synced', external_id: 'remote-1', last_error_code: null, last_error_message: null })
    expect(write.neq).toHaveBeenCalledWith('status', 'synced')
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale failure without changing the newer delivery', async () => {
    const before = row({ idempotency_key: 'matter-1:v2', request_hash: 'hash-2' })
    const store = { value: before }
    const write = atomicQuery(store)
    const error = new IntegrationError({ provider: 'statular', kind: 'attention', code: 'failed', safeMessage: 'Delivery failed.', retryAfterMs: null })
    await expect(recordIntegrationFailure({ ...ref, idempotencyKey: 'matter-1:v1', error })).rejects.toMatchObject({ code: 'integration_record_changed' })
    expect(store.value).toEqual(before)
    expect(write.eq.mock.calls).toEqual([['provider', 'statular'], ['internal_entity_type', 'matter'], ['internal_entity_id', 'matter-1'], ['external_record_type', 'matter'], ['idempotency_key', 'matter-1:v1']])
  })

  it('rejects unnormalized or mismatched provider errors before persistence', async () => {
    await expect(recordIntegrationFailure({ ...ref, idempotencyKey: 'matter-1:v1', error: new Error('RAW_PROVIDER_SECRET') })).rejects.toThrow('normalized')
    await expect(recordIntegrationFailure({ ...ref, idempotencyKey: 'matter-1:v1', error: new IntegrationError({ provider: 'lawmatics', kind: 'attention', code: 'failed', safeMessage: 'Check failed.', retryAfterMs: null }) })).rejects.toThrow('provider')
    expect(from).not.toHaveBeenCalled()
  })

  it('success stores the external ID and clears previous errors without resaving the snapshot', async () => {
    const write = query(row({ external_id: 'remote-1', status: 'synced' }))
    await recordIntegrationSuccess({ ...ref, idempotencyKey: 'matter-1:v1', externalId: 'remote-1' })
    expect(write.update).toHaveBeenCalledWith({ external_id: 'remote-1', status: 'synced', last_error_code: null, last_error_message: null, last_attempt_at: expect.any(String), last_succeeded_at: expect.any(String) })
    expect(write.eq.mock.calls).toEqual([['provider', 'statular'], ['internal_entity_type', 'matter'], ['internal_entity_id', 'matter-1'], ['external_record_type', 'matter'], ['idempotency_key', 'matter-1:v1']])
  })

  it('rejects empty external IDs before recording success', async () => {
    await expect(recordIntegrationSuccess({ ...ref, idempotencyKey: 'matter-1:v1', externalId: ' ' })).rejects.toThrow()
    expect(from).not.toHaveBeenCalled()
  })

  it('reports a stale completion rather than claiming it succeeded', async () => {
    query()
    await expect(recordIntegrationSuccess({ ...ref, idempotencyKey: 'old-key', externalId: 'remote-1' })).rejects.toMatchObject({ code: 'integration_record_changed' })
  })

  it('replaces database errors with a fixed safe message', async () => {
    query(null, { message: 'RAW_PROVIDER_SECRET SNAPSHOT_SECRET' })
    await expect(getExternalRecord(ref)).rejects.toMatchObject({ code: 'integration_persistence_failed', message: 'Unable to persist or read integration record.' })
  })
})
