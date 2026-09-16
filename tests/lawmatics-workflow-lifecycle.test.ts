import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), settings: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/integrations/settings', () => ({ getIntegrationSettings: mocks.settings }))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: async () => ({ timezone: 'America/New_York' }) }))
vi.mock('@/lib/lawmatics', () => ({ getLawmaticsAccessToken: async () => 'PRIVATE-TOKEN' }))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({ ensureDesignSheetSeededFromIntake: vi.fn() }))
vi.mock('@/lib/slaTasks/generate', () => ({ ensureMatterSlaTasks: vi.fn() }))
vi.mock('@/lib/stage-engine/fireStageTasks', () => ({ fireEngineStageTask: vi.fn() }))
vi.mock('@/lib/billing/prepareInvoiceReminders', () => ({ prepareInvoiceReminderDrafts: vi.fn() }))
import { processWorkflowJobs } from '@/lib/workflowJobs'
import { runLawmaticsAppointmentSyncJob } from '@/lib/integrations/lawmatics/jobs'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let history: string[]
let lease: boolean
let releaseDelay: number
let finished: Row | undefined
let cleanupDelay: number
let enabled: boolean
let disableWhenFenced: boolean
let fencedEvent: Row | undefined

// Only database/HTTP boundaries are replaced; the worker, job, services, client,
// normalized errors and record compare-and-swap operations all execute together.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let insertion: Row | undefined
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q },
    is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    update: (value: Row) => { patch = value; return q },
    upsert: (value: Row) => { insertion = value; return q },
    maybeSingle: async () => {
      const rows = db[table] ?? []
      if (insertion) {
        const keys = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
        if (rows.some(row => keys.every(key => row[key] === insertion![key]))) return { data: null, error: null }
        const created = { external_id: null, last_attempt_at: null, ...insertion }
        rows.push(created)
        return { data: { ...created }, error: null }
      }
      const row = rows.find(candidate => filters.every(filter => filter(candidate)))
      if (row && patch) {
        if (cleanupDelay && patch.last_error_code) await new Promise(resolve => setTimeout(resolve, cleanupDelay))
        Object.assign(row, patch)
        if (disableWhenFenced && row.external_record_type === 'event' && patch.status === 'pending' && patch.last_attempt_at) {
          enabled = false
          disableWhenFenced = false
          fencedEvent = structuredClone(row)
        }
        history.push(`persist:${String(patch.status)}`)
      }
      return { data: row ? { ...row } : null, error: null }
    },
  }
  return q
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-16T14:00:00Z'))
  history = []
  lease = false
  releaseDelay = 0
  cleanupDelay = 0
  enabled = true
  disableWhenFenced = false
  fencedEvent = undefined
  finished = undefined
  db = {
    firm_settings: [{ id: 1, durable_workflow_jobs_enabled: true }],
    appointments: [{ id: 'appointment-1', appointment_type_id: 'type-1', status: 'scheduled', source: 'admin',
      linked_lead_id: 'lead-1', linked_matter_id: null, start_time: '2026-09-20T14:00:00Z',
      end_time: '2026-09-20T15:00:00Z', location_type: 'phone' }],
    appointment_types: [{ id: 'type-1', key: 'discovery', label: 'Discovery', location_type: 'phone' }],
    client_intake: [{ id: 'lead-1', first_name: 'Ada', last_name: 'Lovelace', lawmatics_matter_id: 'prospect-1' }],
    integration_external_records: [],
  }
  mocks.from.mockImplementation(query)
  mocks.settings.mockImplementation(async () => ({ lawmaticsAppointmentSyncEnabled: enabled,
    lawmaticsEventTypeIdMap: { discovery: 'type-provider' }, lawmaticsLocationIdMap: {}, lawmaticsUserIds: [] }))
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'claim_workflow_jobs_v2') return { data: [{ id: 'job-1', job_type: 'lawmatics_sync_appointment',
      payload: { appointmentId: 'appointment-1', sourceVersion: 'version-1' }, claim_token: 'PRIVATE-CLAIM', attempts: 1 }], error: null }
    if (name === 'acquire_integration_entity_lease') {
      if (lease) return { data: null, error: null }
      lease = true
      return { data: 'PRIVATE-LEASE', error: null }
    }
    if (name === 'release_integration_entity_lease') {
      if (releaseDelay) await new Promise(resolve => setTimeout(resolve, releaseDelay))
      lease = false
      history.push('release')
      return { data: true, error: null }
    }
    if (name.startsWith('finish_workflow_job_')) {
      history.push('finish')
      finished = { rpc: name, ...args }
      return { data: true, error: null }
    }
    throw new Error('Unexpected fixture RPC')
  })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Lawmatics workflow lifetime', () => {
  it.each([['create', false], ['create', true], ['update', false], ['cancel', false]] as const)(
    'resumes a fenced, unsent Event %s once after local disablement (changed source=%s)', async (operation, changed) => {
    if (operation !== 'create') {
      db.integration_external_records.push({ provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
        external_record_type: 'event', external_id: 'event-1', status: 'synced', source_version: 'old',
        last_attempt_at: '2026-09-16T13:00:00Z', last_succeeded_at: '2026-09-16T13:00:00Z',
        last_error_code: null, last_error_message: null, idempotency_key: 'old-key', request_hash: 'old-hash',
        request_snapshot: { evidence: 'previous' }, metadata: { retained: true } })
    }
    if (operation === 'cancel') db.appointments[0].status = 'cancelled'
    disableWhenFenced = true

    await runLawmaticsAppointmentSyncJob('appointment-1', 'queued-version')

    const event = () => db.integration_external_records.find(row => row.external_record_type === 'event')!
    expect(fencedEvent?.last_attempt_at).toEqual(expect.any(String))
    expect(event()).toEqual({ ...fencedEvent, status: 'disabled', last_error_code: null, last_error_message: null })
    expect(fetch).not.toHaveBeenCalled()
    expect(lease).toBe(false)

    enabled = true
    if (changed) db.appointments[0].start_time = '2026-09-21T14:00:00Z'
    vi.mocked(fetch).mockResolvedValue(operation === 'cancel' ? new Response(null, { status: 204 })
      : Response.json({ data: { id: 'event-1', type: 'event' } }))
    await runLawmaticsAppointmentSyncJob('appointment-1', 'queued-repair')
    expect(event()).toMatchObject({ status: 'synced', external_id: 'event-1', last_error_code: null, last_error_message: null })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe(operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'DELETE')
    await runLawmaticsAppointmentSyncJob('appointment-1', 'queued-repair-again')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['prospect', 'event', 'update', 'cancel'])('aborts %s HTTP and waits for persistence and lease release before finishing a timed-out claim', async operation => {
    if (operation === 'prospect') db.client_intake[0].lawmatics_matter_id = null
    if (operation === 'update' || operation === 'cancel') {
      db.integration_external_records.push({ provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
        external_record_type: 'event', external_id: 'event-1', status: 'synced', source_version: 'old',
        last_attempt_at: null, last_error_code: null, idempotency_key: 'old-key', request_hash: 'old-hash' })
    }
    if (operation === 'cancel') db.appointments[0].status = 'cancelled'
    let signal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => {
        history.push('abort')
        setTimeout(() => reject(new Error('PRIVATE-ABORT-CAUSE')), 100)
      })
    }))
    cleanupDelay = 100
    releaseDelay = 100
    const pending = processWorkflowJobs(1, { budgetMs: 10_000 })
    await vi.advanceTimersByTimeAsync(9_000)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(await pending).toMatchObject({ failed: 1, succeeded: 0 })
    expect(history.indexOf('abort')).toBeLessThan(history.indexOf('release'))
    expect(history.indexOf('release')).toBeLessThan(history.indexOf('finish'))
    expect(lease).toBe(false)
    expect(finished?.p_error).toBe('Workflow execution timed out')
    expect(JSON.stringify(finished)).not.toContain('PRIVATE-ABORT')
    expect(db.integration_external_records.find(row => row.external_record_type === (operation === 'prospect' ? 'prospect' : 'event')))
      .toMatchObject(operation === 'prospect' || operation === 'event'
        ? { status: 'attention', last_error_code: 'create_outcome_unknown' }
        : { status: 'pending', last_error_code: 'timeout' })
    const afterFinish = structuredClone(db.integration_external_records)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(db.integration_external_records).toEqual(afterFinish)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps an unsettled claim and entity lease for recovery instead of completing during cleanup', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('PRIVATE-CAUSE')))
    }))
    cleanupDelay = 20_000
    const pending = processWorkflowJobs(1, { budgetMs: 10_000 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(finished).toBeUndefined()
    expect(lease).toBe(true)
    expect(await pending).toMatchObject({ message: 'Workflow cancellation did not settle; claim retained for lease recovery' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(finished).toBeUndefined()
  })

  it.each([['180', 180_000], ['Wed, 16 Sep 2026 14:03:00 GMT', 180_000], ['999999999', 86_400_000]])(
    'carries bounded Retry-After %s from HTTP through services to workflow scheduling', async (header, delay) => {
      vi.mocked(fetch).mockResolvedValue(new Response('PRIVATE-PROVIDER-BODY', { status: 429, headers: { 'Retry-After': header } }))
      expect(await processWorkflowJobs(1)).toMatchObject({ failed: 1 })
      expect(finished).toMatchObject({ rpc: 'finish_workflow_job_v3', p_retry_after_ms: delay })
      expect(finished?.p_error).not.toContain('PRIVATE')
      expect(lease).toBe(false)
    })

  it('queues recent shared-Prospect contention and recovers after the winner persists its mapping', async () => {
    db.client_intake[0].lawmatics_matter_id = null
    db.integration_external_records.push({ provider: 'lawmatics', internal_entity_type: 'lead', internal_entity_id: 'lead-1',
      external_record_type: 'prospect', external_id: null, status: 'pending', last_error_code: null,
      last_attempt_at: new Date().toISOString(), idempotency_key: 'inflight-prospect', source_version: 'inflight' })
    expect(await processWorkflowJobs(1)).toMatchObject({ failed: 1 })
    expect(db.integration_external_records.some(row => row.status === 'attention')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    Object.assign(db.integration_external_records[0], { external_id: 'winner-prospect', status: 'synced' })
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { id: 'event-1', type: 'event' } }))
    expect(await processWorkflowJobs(1)).toMatchObject({ succeeded: 1 })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).eventable_id).toBe('winner-prospect')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([121_000, 20_000])('marks an abandoned Event attempt attention once after its owning lease expired (attempt age %i)', async age => {
    const abandoned = { provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
      external_record_type: 'event', external_id: null, status: 'pending', last_error_code: null,
      last_attempt_at: new Date(Date.now() - age).toISOString(), idempotency_key: 'abandoned', source_version: 'old',
      request_snapshot: { original: 'evidence' }, request_hash: 'original-hash' }
    db.integration_external_records.push({ ...abandoned })
    await runLawmaticsAppointmentSyncJob('appointment-1', 'new')
    expect(db.integration_external_records[0]).toMatchObject({ ...abandoned, status: 'attention', last_error_code: 'create_outcome_unknown' })
    const saved = structuredClone(db.integration_external_records)
    await runLawmaticsAppointmentSyncJob('appointment-1', 'newer')
    expect(db.integration_external_records).toEqual(saved)
    expect(fetch).not.toHaveBeenCalled()
  })
})
