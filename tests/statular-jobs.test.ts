import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  config: vi.fn(),
  sync: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/integrations/statular/config', () => ({ getStatularConfig: mocks.config }))
vi.mock('@/lib/integrations/statular/clients', () => ({ syncStatularClient: mocks.sync }))

import {
  enqueueStatularClientForAppointment,
  enqueueStatularClientForFitMatter,
  runStatularClientSyncJob,
} from '@/lib/integrations/statular/jobs'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let jobs: Map<string, Row>
let readFailure: string | null
let beforeWrite: ((table: string, patch: Row) => Promise<void>) | null
let mutations: Row[]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  return settled
}

function integrationError(kind: 'attention' | 'retryable', code: string) {
  return new IntegrationError({
    provider: 'statular', kind, code, safeMessage: 'Safe Statular failure.', retryAfterMs: null,
  })
}

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let insertion: Row | undefined
  let projection = '*'
  let signal: AbortSignal | undefined
  const q = {
    select: vi.fn((fields = '*') => { projection = fields; return q }),
    eq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    neq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] !== value); return q }),
    is: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    update: vi.fn((value: Row) => { patch = value; return q }),
    upsert: vi.fn((value: Row) => { insertion = value; return q }),
    abortSignal: vi.fn((value: AbortSignal) => { signal = value; return q }),
    maybeSingle: vi.fn(async () => {
      if (readFailure === table) return { data: null, error: { message: 'PRIVATE-DB-CAUSE' } }
      const rows = db[table] ?? []
      if (insertion) {
        mutations.push(insertion)
        const committed = (async () => {
          if (beforeWrite) await beforeWrite(table, insertion!)
          const keys = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
          if (rows.some(row => keys.every(key => row[key] === insertion![key]))) return { data: null, error: null }
          const created = {
            external_id: null, last_attempt_at: null, last_succeeded_at: null,
            last_error_code: null, last_error_message: null, request_snapshot: null,
            request_hash: null, metadata: {}, ...insertion,
          }
          rows.push(created)
          return { data: { ...created }, error: null }
        })()
        if (!signal) return committed
        if (signal.aborted) return { data: null, error: { message: 'AbortError: request cancelled' } }
        return Promise.race([
          committed,
          new Promise<{ data: null; error: { message: string } }>(resolve => {
            signal!.addEventListener('abort', () => resolve({
              data: null, error: { message: 'AbortError: request cancelled' },
            }), { once: true })
          }),
        ])
      }
      if (patch) {
        mutations.push(patch)
        const committed = (async () => {
          if (beforeWrite) await beforeWrite(table, patch!)
          const row = rows.find(candidate => filters.every(filter => filter(candidate)))
          if (row) Object.assign(row, patch)
          return { data: row ? { ...row } : null, error: null }
        })()
        if (!signal) return committed
        if (signal.aborted) return { data: null, error: { message: 'AbortError: request cancelled' } }
        return Promise.race([
          committed,
          new Promise<{ data: null; error: { message: string } }>(resolve => {
            signal!.addEventListener('abort', () => resolve({
              data: null, error: { message: 'AbortError: request cancelled' },
            }), { once: true })
          }),
        ])
      }
      if (signal?.aborted) return { data: null, error: { message: 'AbortError: request cancelled' } }
      const row = rows.find(candidate => filters.every(filter => filter(candidate)))
      return { data: row
        ? projection === '*'
          ? { ...row }
          : Object.fromEntries(projection.split(',').map(key => [key.trim(), row[key.trim()]]))
        : null, error: null }
    }),
  }
  return q
}

const record = () => db.integration_external_records[0]

beforeEach(() => {
  vi.clearAllMocks()
  readFailure = null
  beforeWrite = null
  mutations = []
  jobs = new Map()
  db = {
    integration_settings: [{ id: 1, statular_sync_enabled: true }],
    appointments: [{
      id: 'appointment-1', source: 'public', linked_lead_id: 'lead-1', linked_matter_id: null,
      attendee_email: 'PRIVATE-PII@example.test', notes: 'PRIVATE-NOTES',
    }],
    matters: [{ id: 'matter-1', client_intake_id: 'lead-1' }],
    integration_external_records: [],
  }
  mocks.from.mockImplementation(query)
  mocks.config.mockReturnValue({
    clientWebhookUrl: 'https://statular.test/client-secret',
    matterWebhookUrl: 'https://statular.test/matter-secret',
    generation: 'generation-1',
  })
  mocks.sync.mockResolvedValue({ operation: 'created' })
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name !== 'enqueue_workflow_job') throw new Error(`Unexpected RPC ${name}`)
    const key = String(args.p_dedupe_key)
    if (!jobs.has(key)) jobs.set(key, args)
    return { data: jobs.get(key), error: null }
  })
})

describe('Statular client enqueue', () => {
  it('deduplicates a linked lead by intake and generation with an opaque payload', async () => {
    await enqueueStatularClientForAppointment('appointment-1')
    await enqueueStatularClientForAppointment('appointment-1')

    expect(jobs.size).toBe(1)
    const job = [...jobs.values()][0]
    expect(job).toMatchObject({
      p_job_type: 'statular_create_client',
      p_dedupe_key: 'statular-client:lead-1:generation-1',
      p_payload: { clientIntakeId: 'lead-1' },
      p_actor_id: null,
      p_matter_id: null,
    })
    expect(Object.keys(job.p_payload as Row)).toEqual(['clientIntakeId'])
    expect(JSON.stringify(job)).not.toMatch(/PRIVATE|statular\.test/)
  })

  it('resolves the client intake through a linked matter', async () => {
    db.appointments[0].linked_lead_id = null
    db.appointments[0].linked_matter_id = 'matter-1'

    await enqueueStatularClientForAppointment('appointment-1')

    expect([...jobs.values()][0]).toMatchObject({
      p_dedupe_key: 'statular-client:lead-1:generation-1',
      p_payload: { clientIntakeId: 'lead-1' },
    })
  })

  it('does not enqueue conflicting explicit lead and matter identities', async () => {
    db.appointments[0].linked_matter_id = 'matter-1'
    db.matters[0].client_intake_id = 'different-lead'

    await expect(enqueueStatularClientForAppointment('appointment-1')).resolves.toBeUndefined()

    expect(jobs.size).toBe(0)
  })

  it('uses one dedupe identity for repeat bookings of the same intake and generation', async () => {
    db.appointments.push({
      id: 'appointment-2', source: 'portal', linked_lead_id: null, linked_matter_id: 'matter-1',
    })

    await enqueueStatularClientForAppointment('appointment-1')
    await enqueueStatularClientForAppointment('appointment-2')

    expect(jobs.size).toBe(1)
    expect([...jobs.keys()]).toEqual(['statular-client:lead-1:generation-1'])
  })

  it('does not enqueue while disabled or for a Calendly helper input', async () => {
    db.integration_settings[0].statular_sync_enabled = false
    await enqueueStatularClientForAppointment('appointment-1')
    db.integration_settings[0].statular_sync_enabled = true
    db.appointments[0].source = 'calendly'
    await enqueueStatularClientForAppointment('appointment-1')
    expect(jobs.size).toBe(0)
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it.each(['integration_settings', 'appointments', 'matters'])('returns only a safe read failure for %s', async table => {
    if (table === 'matters') db.appointments[0].linked_matter_id = 'matter-1'
    readFailure = table
    const error = await enqueueStatularClientForAppointment('appointment-1').catch(reason => reason)
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error('Expected an Error')
    expect(error.message).toBe('Unable to enqueue Statular client synchronization.')
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|statular\.test/)
    expect(jobs.size).toBe(0)
  })
})

describe('Statular client on fit decision', () => {
  beforeEach(() => {
    db.matters[0].fit_decision = 'fit'
  })

  it('enqueues the client intake once the matter is marked a fit', async () => {
    await enqueueStatularClientForFitMatter('matter-1')
    await enqueueStatularClientForFitMatter('matter-1')

    expect(jobs.size).toBe(1)
    expect([...jobs.values()][0]).toMatchObject({
      p_job_type: 'statular_create_client',
      p_dedupe_key: 'statular-client:lead-1:generation-1',
      p_payload: { clientIntakeId: 'lead-1' },
      p_actor_id: null,
    })
  })

  it('shares the dedupe identity with an appointment-linked enqueue of the same intake', async () => {
    await enqueueStatularClientForAppointment('appointment-1')
    await enqueueStatularClientForFitMatter('matter-1')

    expect([...jobs.keys()]).toEqual(['statular-client:lead-1:generation-1'])
  })

  it.each([['not_a_fit'], [null]])('does not enqueue when the decision is %s', async decision => {
    db.matters[0].fit_decision = decision

    await expect(enqueueStatularClientForFitMatter('matter-1')).resolves.toBeUndefined()

    expect(jobs.size).toBe(0)
  })

  it('does not enqueue a matter without a client intake', async () => {
    db.matters[0].client_intake_id = null

    await expect(enqueueStatularClientForFitMatter('matter-1')).resolves.toBeUndefined()

    expect(jobs.size).toBe(0)
  })

  it('does nothing while synchronization is disabled', async () => {
    db.integration_settings[0].statular_sync_enabled = false

    await enqueueStatularClientForFitMatter('matter-1')

    expect(jobs.size).toBe(0)
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it.each(['integration_settings', 'matters'])('returns only a safe failure when %s cannot be read', async table => {
    readFailure = table
    const error = await enqueueStatularClientForFitMatter('matter-1').catch(reason => reason) as Error
    expect(error).toBeInstanceOf(IntegrationError)
    expect(error.message).toBe('Unable to enqueue Statular client synchronization.')
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|statular\.test/)
    expect(jobs.size).toBe(0)
  })

  it('returns a safe failure when the client webhook is not configured', async () => {
    mocks.config.mockImplementation(() => { throw new Error('PRIVATE-STATULAR-WEBHOOK-URL') })
    const error = await enqueueStatularClientForFitMatter('matter-1').catch(reason => reason) as Error
    expect(error).toBeInstanceOf(IntegrationError)
    expect(JSON.stringify(error) + String(error.message)).not.toContain('PRIVATE')
    expect(jobs.size).toBe(0)
  })
})

describe('Statular client workflow job', () => {
  it('rechecks enablement and configuration and propagates the worker signal', async () => {
    const controller = new AbortController()
    await runStatularClientSyncJob('lead-1', controller.signal)
    expect(mocks.config).toHaveBeenCalledTimes(1)
    expect(mocks.sync).toHaveBeenCalledWith('lead-1', controller.signal)
  })

  it('completes disabled-after-enqueue with a safe non-attempt record', async () => {
    db.integration_settings[0].statular_sync_enabled = false
    await expect(runStatularClientSyncJob('lead-1')).resolves.toBeUndefined()
    expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(record()).toMatchObject({
      provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'client', status: 'disabled', last_attempt_at: null,
      request_hash: null, request_snapshot: null,
    })
  })

  it('persists configuration attention without an attempt and completes', async () => {
    mocks.config.mockImplementation(() => { throw integrationError('attention', 'configuration_required') })
    await expect(runStatularClientSyncJob('lead-1')).resolves.toBeUndefined()
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(record()).toMatchObject({
      status: 'attention', last_error_code: 'configuration_required',
      last_error_message: 'Safe Statular failure.', last_attempt_at: null,
      request_hash: null, request_snapshot: null,
      source_version: 'statular-client-preflight:v1',
      idempotency_key: 'cornerstone:statular:preflight-client:lead-1:v1',
    })
  })

  it('does not persist preflight attention after the job is cancelled', async () => {
    const syncStarted = deferred<void>()
    const rejectSync = deferred<void>()
    mocks.sync.mockImplementationOnce(async () => {
      syncStarted.resolve()
      await rejectSync.promise
      throw integrationError('attention', 'identity_required')
    })
    const controller = new AbortController()

    const running = runStatularClientSyncJob('lead-1', controller.signal)
    await syncStarted.promise
    controller.abort()
    rejectSync.resolve()

    await expect(running).rejects.toMatchObject({ kind: 'retryable', code: 'timeout' })
    expect(record()).toBeUndefined()
  })

  it('awaits an accepted preflight insert before cancellation settles', async () => {
    db.integration_settings[0].statular_sync_enabled = false
    const writeStarted = deferred<void>()
    const resumeWrite = deferred<void>()
    beforeWrite = async (table, patch) => {
      if (table !== 'integration_external_records' || patch.status !== 'disabled') return
      writeStarted.resolve()
      await resumeWrite.promise
    }
    const controller = new AbortController()

    const running = runStatularClientSyncJob('lead-1', controller.signal)
    await writeStarted.promise
    controller.abort()

    expect(await hasSettled(running)).toBe(false)
    expect(record()).toBeUndefined()

    resumeWrite.resolve()
    await expect(running).rejects.toMatchObject({ kind: 'retryable', code: 'timeout' })
    expect(record()).toMatchObject({ status: 'disabled', last_attempt_at: null })
    expect(mutations).toHaveLength(1)
  })

  it('awaits an accepted preflight update before cancellation settles', async () => {
    db.integration_external_records.push({
      provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'client', status: 'disabled', source_version: 'statular-client-preflight:v1',
      idempotency_key: 'cornerstone:statular:preflight-client:lead-1:v1', request_hash: null,
      request_snapshot: null, external_id: null, last_attempt_at: null, last_succeeded_at: null,
      last_error_code: null, last_error_message: null, metadata: {},
    })
    mocks.config.mockImplementation(() => { throw integrationError('attention', 'configuration_required') })
    const writeStarted = deferred<void>()
    const resumeWrite = deferred<void>()
    beforeWrite = async (table, patch) => {
      if (table !== 'integration_external_records' || patch.status !== 'attention') return
      writeStarted.resolve()
      await resumeWrite.promise
    }
    const controller = new AbortController()

    const running = runStatularClientSyncJob('lead-1', controller.signal)
    await writeStarted.promise
    controller.abort()

    expect(await hasSettled(running)).toBe(false)
    expect(record()).toMatchObject({ status: 'disabled', last_error_code: null })

    resumeWrite.resolve()
    await expect(running).rejects.toMatchObject({ kind: 'retryable', code: 'timeout' })
    expect(record()).toMatchObject({ status: 'attention', last_error_code: 'configuration_required' })
    expect(mutations).toHaveLength(1)
  })

  it('persists source-data preflight attention and completes', async () => {
    mocks.sync.mockRejectedValue(integrationError('attention', 'identity_required'))
    await expect(runStatularClientSyncJob('lead-1')).resolves.toBeUndefined()
    expect(record()).toMatchObject({
      status: 'attention', last_error_code: 'identity_required', last_attempt_at: null,
    })
  })

  it('preserves provider attention already written by the synchronization service', async () => {
    const providerState = {
      provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'client', status: 'attention', source_version: 'payload-hash',
      idempotency_key: 'cornerstone:statular:client:lead-1:generation-1', request_hash: 'payload-hash',
      request_snapshot: { first_name: 'PRIVATE', last_name: 'PRIVATE' }, external_id: null,
      last_attempt_at: '2026-09-16T14:00:00Z', last_error_code: 'permission_denied',
      last_error_message: 'Safe provider failure.',
    }
    mocks.sync.mockImplementation(async () => {
      db.integration_external_records.push({ ...providerState })
      throw integrationError('attention', 'permission_denied')
    })

    await expect(runStatularClientSyncJob('lead-1')).resolves.toBeUndefined()

    expect(record()).toEqual(providerState)
  })

  it.each(['active', 'synced', 'attention'] as const)('does not overwrite %s evidence during disabled preflight', async evidence => {
    const previous = {
      provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'client', status: evidence === 'active' ? 'pending' : evidence,
      source_version: 'payload-hash', idempotency_key: 'provider-key', request_hash: 'payload-hash',
      request_snapshot: { first_name: 'PRIVATE', last_name: 'PRIVATE' },
      external_id: evidence === 'synced' ? 'external-1' : null,
      last_attempt_at: '2026-09-16T14:00:00Z',
      last_error_code: evidence === 'attention' ? 'permission_denied' : null,
      last_error_message: evidence === 'attention' ? 'Safe provider failure.' : null,
    }
    db.integration_external_records.push({ ...previous })
    db.integration_settings[0].statular_sync_enabled = false

    await runStatularClientSyncJob('lead-1')

    expect(record()).toEqual(previous)
  })

  it('does not overwrite a real frozen pending claim before its first attempt', async () => {
    const pending = {
      provider: 'statular', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'client', status: 'pending', source_version: 'real-payload-hash',
      idempotency_key: 'cornerstone:statular:client:lead-1:generation-1',
      request_hash: 'real-payload-hash', request_snapshot: { first_name: 'PRIVATE', last_name: 'PRIVATE' },
      external_id: null, last_attempt_at: null, last_succeeded_at: null,
      last_error_code: null, last_error_message: null,
    }
    db.integration_external_records.push({ ...pending })
    db.integration_settings[0].statular_sync_enabled = false

    await runStatularClientSyncJob('lead-1')

    expect(record()).toEqual(pending)
  })

  it('preserves unattempted attention when a later queued job is disabled', async () => {
    mocks.sync.mockRejectedValueOnce(integrationError('attention', 'identity_required'))
    await runStatularClientSyncJob('lead-1')
    const previous = structuredClone(record())
    db.integration_settings[0].statular_sync_enabled = false

    await runStatularClientSyncJob('lead-1')

    expect(record()).toEqual(previous)
  })

  it('rethrows only retryable failures for workflow backoff', async () => {
    mocks.sync.mockRejectedValueOnce(integrationError('retryable', 'provider_unavailable'))
    await expect(runStatularClientSyncJob('lead-1')).rejects.toMatchObject({
      provider: 'statular', kind: 'retryable', code: 'provider_unavailable',
    })
    mocks.sync.mockRejectedValueOnce(integrationError('attention', 'validation_failed'))
    await expect(runStatularClientSyncJob('lead-1')).resolves.toBeUndefined()
  })

  it('normalizes unexpected errors before the generic worker can persist them', async () => {
    mocks.sync.mockRejectedValue(new Error('PRIVATE-TOKEN-PROVIDER-URL'))
    const error = await runStatularClientSyncJob('lead-1').catch(reason => reason)
    expect(error).toMatchObject({
      provider: 'statular', kind: 'retryable', code: 'synchronization_failed',
      message: 'Statular client synchronization could not be completed.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|URL/)
  })
})
