import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), sync: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/integrations/lawmatics/appointments', () => ({ syncLawmaticsAppointment: mocks.sync }))
import { enqueueLawmaticsAppointmentSync, runLawmaticsAppointmentSyncJob } from '@/lib/integrations/lawmatics/jobs'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let jobs: Map<string, Row>
let leases: Map<string, string>
let leaseFailure: boolean
const error = (kind: 'attention' | 'retryable', code: string) => new IntegrationError({
  provider: 'lawmatics', kind, code, safeMessage: 'Safe integration error.', retryAfterMs: null,
})
const record = () => db.integration_external_records[0]
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let insertion: Row | undefined
  let projection = '*'
  const q = {
    select: vi.fn((fields = '*') => { projection = fields; return q }),
    eq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    neq: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] !== value); return q }),
    is: vi.fn((key: string, value: unknown) => { filters.push(row => row[key] === value); return q }),
    update: vi.fn((value: Row) => { patch = value; return q }),
    upsert: vi.fn((value: Row) => { insertion = value; return q }),
    maybeSingle: vi.fn(async () => {
      const rows = db[table] ?? []
      if (insertion) {
        const keys = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
        if (rows.some(row => keys.every(key => row[key] === insertion![key]))) return { data: null, error: null }
        const created = { external_id: null, last_attempt_at: null, last_error_code: null,
          last_error_message: null, request_snapshot: null, request_hash: null, metadata: {}, ...insertion }
        rows.push(created)
        return { data: { ...created }, error: null }
      }
      const row = rows.find(candidate => filters.every(filter => filter(candidate)))
      if (row && patch) Object.assign(row, patch)
      return { data: row ? projection === '*' ? { ...row }
        : Object.fromEntries(projection.split(',').map(key => [key.trim(), row[key.trim()]])) : null, error: null }
    }),
  }
  return q
}

beforeEach(() => {
  vi.clearAllMocks()
  jobs = new Map()
  leases = new Map()
  leaseFailure = false
  db = {
    integration_settings: [{ id: 1, lawmatics_appointment_sync_enabled: true }],
    appointments: [{ id: 'appointment-1', source: 'public', status: 'scheduled', appointment_type_id: 'type-1',
      start_time: '2026-09-20T14:00:00Z', end_time: '2026-09-20T15:00:00Z', location_type: 'phone',
      linked_lead_id: 'lead-1', linked_matter_id: null, updated_at: '2026-09-15T12:00:00Z',
      notes: 'PRIVATE-NOTES', manage_token_hash: 'SECRET-TOKEN' }],
    integration_external_records: [],
  }
  mocks.from.mockImplementation(query)
  mocks.sync.mockReset().mockResolvedValue({ operation: 'created' })
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'enqueue_workflow_job') {
      const key = args.p_dedupe_key as string
      if (!jobs.has(key)) jobs.set(key, args)
      return { data: jobs.get(key), error: null }
    }
    if (name === 'reopen_integration_workflow_job') return { data: 'job-1', error: null }
    const key = `${args.p_provider}:${args.p_entity_type}:${args.p_entity_id}`
    if (name === 'acquire_integration_entity_lease') {
      if (leaseFailure) return { data: null, error: { message: 'PRIVATE-DB-DETAIL' } }
      if (leases.has(key)) return { data: null, error: null }
      const token = `secret-lease-${leases.size}`
      leases.set(key, token)
      return { data: token, error: null }
    }
    if (name === 'release_integration_entity_lease') {
      const match = leases.get(key) === args.p_lease_token
      if (match) leases.delete(key)
      return { data: match, error: null }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })
})

describe('Lawmatics appointment jobs', () => {
  it('deduplicates one committed version and carries only opaque source identifiers', async () => {
    await enqueueLawmaticsAppointmentSync('appointment-1', 'actor-1')
    await enqueueLawmaticsAppointmentSync('appointment-1', 'actor-1')
    expect(jobs.size).toBe(1)
    const job = [...jobs.values()][0]
    expect(job).toMatchObject({ p_job_type: 'lawmatics_sync_appointment', p_actor_id: 'actor-1' })
    expect(job.p_payload).toEqual({ appointmentId: 'appointment-1', sourceVersion: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(job.p_dedupe_key).toBe(`lawmatics:appointment:event:appointment-1:${(job.p_payload as Row).sourceVersion}`)
    expect(JSON.stringify(job)).not.toMatch(/PRIVATE|SECRET/)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'reopen_integration_workflow_job')).toBe(false)
  })

  it('explicit repair can reopen only the exact enqueued Lawmatics source-version job', async () => {
    await enqueueLawmaticsAppointmentSync('appointment-1', null, { reopenTerminal: true })
    const job = [...jobs.values()][0]
    expect(mocks.rpc).toHaveBeenLastCalledWith('reopen_integration_workflow_job', {
      p_job_type: 'lawmatics_sync_appointment', p_dedupe_key: job.p_dedupe_key,
    })
    expect(jobs.size).toBe(1)
  })

  it('enqueues a new version after reschedule, cancel, or a return to a previously used time', async () => {
    await enqueueLawmaticsAppointmentSync('appointment-1')
    db.appointments[0].start_time = '2026-09-21T14:00:00Z'
    await enqueueLawmaticsAppointmentSync('appointment-1')
    db.appointments[0].start_time = '2026-09-20T14:00:00Z'
    db.appointments[0].updated_at = '2026-09-15T13:00:00Z'
    await enqueueLawmaticsAppointmentSync('appointment-1')
    db.appointments[0].status = 'cancelled'
    await enqueueLawmaticsAppointmentSync('appointment-1')
    expect(jobs.size).toBe(4)
  })

  it('does not enqueue disabled or Calendly sources', async () => {
    db.integration_settings[0].lawmatics_appointment_sync_enabled = false
    await enqueueLawmaticsAppointmentSync('appointment-1')
    db.integration_settings[0].lawmatics_appointment_sync_enabled = true
    db.appointments[0].source = 'calendly'
    await enqueueLawmaticsAppointmentSync('appointment-1')
    expect(jobs.size).toBe(0)
  })

  it('completes a disabled queued job without calling the provider and records disabled state', async () => {
    db.integration_settings[0].lawmatics_appointment_sync_enabled = false
    await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'old-version')).resolves.toBeUndefined()
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(record()).toMatchObject({ status: 'disabled', internal_entity_id: 'appointment-1', last_attempt_at: null })
  })

  it('rechecks enablement after acquiring the lease before provider work', async () => {
    const rpc = mocks.rpc.getMockImplementation()!
    mocks.rpc.mockImplementation(async (name: string, args: Row) => {
      const result = await rpc(name, args)
      if (name === 'acquire_integration_entity_lease') db.integration_settings[0].lawmatics_appointment_sync_enabled = false
      return result
    })
    await runLawmaticsAppointmentSyncJob('appointment-1', 'version')
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(leases.size).toBe(0)
    expect(record()).toMatchObject({ status: 'disabled' })
  })

  it('persists preflight attention and completes without retrying', async () => {
    mocks.sync.mockRejectedValue(error('attention', 'configuration_required'))
    await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'version')).resolves.toBeUndefined()
    expect(record()).toMatchObject({ status: 'attention', last_error_code: 'configuration_required', last_attempt_at: null })
    expect(leases.size).toBe(0)
  })

  it.each(['configuration_required', 'identity_required'])('preserves unattempted %s attention when a later queued version is disabled', async code => {
    mocks.sync.mockRejectedValueOnce(error('attention', code))
    await runLawmaticsAppointmentSyncJob('appointment-1', 'preflight-version')
    expect(record()).toMatchObject({ status: 'attention', last_attempt_at: null,
      last_error_code: code, last_error_message: 'Safe integration error.', source_version: 'preflight-version',
      idempotency_key: 'lawmatics:event:appointment-1:preflight:preflight-version' })
    const original = structuredClone(record())

    db.integration_settings[0].lawmatics_appointment_sync_enabled = false
    await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'later-queued-version')).resolves.toBeUndefined()

    expect(record()).toEqual(original)
    expect(mocks.sync).toHaveBeenCalledTimes(1)
  })

  it('still marks a truly unattempted non-attention record disabled', async () => {
    const pending = { provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
      external_record_type: 'event', status: 'pending', source_version: 'pending-version', idempotency_key: 'pending-key',
      last_attempt_at: null, last_error_code: null, last_error_message: null, request_snapshot: null, external_id: null }
    db.integration_external_records.push({ ...pending })
    db.integration_settings[0].lawmatics_appointment_sync_enabled = false

    await runLawmaticsAppointmentSyncJob('appointment-1', 'later-queued-version')

    expect(record()).toEqual({ ...pending, status: 'disabled' })
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('preserves the attempt fence and snapshot already persisted by Task 3', async () => {
    const persisted = { provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
      external_record_type: 'event', status: 'attention', source_version: 'provider-version', idempotency_key: 'provider-key',
      last_attempt_at: '2026-09-15T14:00:00Z', last_error_code: 'create_outcome_unknown',
      request_snapshot: { status: 'scheduled' }, request_hash: 'provider-hash', external_id: null }
    mocks.sync.mockImplementation(async () => {
      db.integration_external_records.push({ ...persisted })
      throw error('attention', 'create_outcome_unknown')
    })
    await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'version')).resolves.toBeUndefined()
    expect(record()).toEqual(persisted)
  })

  it('does not overwrite an active attempt when disabling a queued job', async () => {
    const active = { provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
      external_record_type: 'event', status: 'pending', source_version: 'newer-version', idempotency_key: 'newer-key',
      last_attempt_at: '2026-09-15T14:00:00Z', last_error_code: null, request_snapshot: { status: 'scheduled' } }
    db.integration_external_records.push({ ...active })
    db.integration_settings[0].lawmatics_appointment_sync_enabled = false
    await runLawmaticsAppointmentSyncJob('appointment-1', 'version')
    expect(record()).toEqual(active)
  })

  it.each(['attention', 'synced'])('preserves prior %s outcome evidence when disabling', async status => {
    const previous = { provider: 'lawmatics', internal_entity_type: 'appointment', internal_entity_id: 'appointment-1',
      external_record_type: 'event', status, source_version: 'provider-version', idempotency_key: 'provider-key',
      last_attempt_at: '2026-09-15T14:00:00Z', last_error_code: status === 'attention' ? 'rate_limited' : null,
      request_snapshot: { status: 'cancelled' }, external_id: null }
    db.integration_external_records.push({ ...previous })
    db.integration_settings[0].lawmatics_appointment_sync_enabled = false
    await runLawmaticsAppointmentSyncJob('appointment-1', 'version')
    expect(record()).toEqual(previous)
  })

  it.each(['success', 'attention', 'retryable'])('releases the entity lease after %s', async outcome => {
    if (outcome !== 'success') mocks.sync.mockRejectedValue(error(outcome as 'attention' | 'retryable', 'test_failure'))
    const result = runLawmaticsAppointmentSyncJob('appointment-1', 'version')
    if (outcome === 'retryable') await expect(result).rejects.toMatchObject({ kind: 'retryable' })
    else await expect(result).resolves.toBeUndefined()
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'acquire_integration_entity_lease')).toBe(true)
    expect(leases.size).toBe(0)
  })

  it('excludes concurrent source versions for the same appointment while allowing different appointments', async () => {
    let complete!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    mocks.sync.mockImplementationOnce(async () => {
      entered()
      await new Promise<void>(resolve => { complete = resolve })
    })
    const first = runLawmaticsAppointmentSyncJob('appointment-1', 'version-1')
    await started
    try {
      await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'version-2')).rejects.toMatchObject({ kind: 'retryable', code: 'integration_busy' })
      await expect(runLawmaticsAppointmentSyncJob('appointment-2', 'version-1')).resolves.toBeUndefined()
      expect(mocks.sync.mock.calls.map(([id]) => id)).toEqual(['appointment-1', 'appointment-2'])
    } finally { complete(); await first }
  })

  it('does not call the provider when lease acquisition fails and hides database detail', async () => {
    leaseFailure = true
    await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'version')).rejects.toMatchObject({ kind: 'retryable', code: 'integration_persistence_failed' })
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('normalizes unexpected errors before the generic worker can persist them', async () => {
    mocks.sync.mockRejectedValue(new Error('SECRET-TOKEN-PROVIDER-BODY'))
    await expect(runLawmaticsAppointmentSyncJob('appointment-1', 'version')).rejects.toMatchObject({
      kind: 'retryable', message: 'Lawmatics synchronization could not be completed.',
    })
  })
})

// Explicit disposable local database only; normal unit runs do not require Docker.
const fixtureDatabase = process.env.VITEST_LAWMATICS_TEST_DATABASE
const fixtureContainer = process.env.VITEST_LAWMATICS_TEST_CONTAINER
const sqlArgs = (sql: string) => {
  if (!fixtureDatabase?.startsWith('codex_lawmatics_task4_') || !fixtureContainer?.startsWith('supabase_db_')) {
    throw new Error('An explicit isolated local Lawmatics fixture is required')
  }
  return ['exec', fixtureContainer, 'psql', '-X', '-U', 'postgres', '-d', fixtureDatabase, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]
}
const sql = (statement: string) => execFileSync('docker', sqlArgs(statement), { encoding: 'utf8' }).trim()
describe.skipIf(!fixtureDatabase)('Lawmatics migration and entity leases in local Postgres', () => {
  beforeAll(() => {
    const path = 'supabase/migrations/20261205000000_lawmatics_appointment_jobs.sql'
    const migration = existsSync(path) ? readFileSync(path, 'utf8') : ''
    sql(`create table public.workflow_jobs (id uuid primary key default gen_random_uuid(),
      dedupe_key text unique, status text default 'pending', attempts integer default 0, max_attempts integer default 5,
      available_at timestamptz default now(), locked_at timestamptz, locked_by text, claim_token uuid,
      lease_expires_at timestamptz, last_error text, completed_at timestamptz, updated_at timestamptz default now(), job_type text not null
      check (job_type in ('seed_design_sheet','ensure_sla_plan','fire_stage_task','release_billing_milestone','annual_review','prepare_invoice_reminders')));
      grant select on public.workflow_jobs to authenticated;
      insert into public.workflow_jobs(job_type) values ('seed_design_sheet'),('ensure_sla_plan'),('fire_stage_task'),
        ('release_billing_milestone'),('annual_review'),('prepare_invoice_reminders');
      ${migration}`)
  })

  it('preserves all old types, rows, and grants while accepting Lawmatics jobs', () => {
    expect(sql('select count(*) from public.workflow_jobs')).toBe('6')
    expect(sql("select has_table_privilege('authenticated','public.workflow_jobs','SELECT')")).toBe('t')
    expect(sql("insert into public.workflow_jobs(job_type) values ('lawmatics_sync_appointment') returning job_type").split('\n')[0])
      .toBe('lawmatics_sync_appointment')
  })

  it('atomically excludes same-entity contenders but permits other entities', async () => {
    const statement = "select public.acquire_integration_entity_lease('lawmatics','appointment','00000000-0000-0000-0000-000000000001')"
    const contenders = await Promise.all([1, 2].map(() => promisify(execFile)('docker', sqlArgs(statement))))
    expect(contenders.map(result => result.stdout.trim()).filter(Boolean)).toHaveLength(1)
    expect(sql("select public.acquire_integration_entity_lease('lawmatics','appointment','00000000-0000-0000-0000-000000000002') is not null"))
      .toBe('t')
  })

  it('allows expired takeover and refuses a stale or mismatched release token', () => {
    const id = '00000000-0000-0000-0000-000000000003'
    const first = sql(`select public.acquire_integration_entity_lease('lawmatics','appointment','${id}')`)
    expect(sql(`select lease_expires_at > clock_timestamp() + interval '110 seconds'
      and lease_expires_at <= clock_timestamp() + interval '120 seconds' from public.integration_entity_leases where entity_id='${id}'`)).toBe('t')
    sql(`update public.integration_entity_leases set lease_expires_at=clock_timestamp()-interval '1 second' where entity_id='${id}'`)
    const second = sql(`select public.acquire_integration_entity_lease('lawmatics','appointment','${id}')`)
    expect(second).not.toBe(first)
    expect(sql(`select public.release_integration_entity_lease('lawmatics','appointment','${id}','${first}')`)).toBe('f')
    expect(sql(`select public.acquire_integration_entity_lease('lawmatics','appointment','${id}') is null`)).toBe('t')
    expect(sql(`select public.release_integration_entity_lease('lawmatics','appointment','${id}','${second}')`)).toBe('t')
    expect(sql(`select public.acquire_integration_entity_lease('lawmatics','appointment','${id}') is not null`)).toBe('t')
  })

  it('exposes lease storage and RPCs only to the service role', () => {
    expect(sql("select relrowsecurity from pg_class where oid='public.integration_entity_leases'::regclass")).toBe('t')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const allowed = role === 'service_role' ? 't' : 'f'
      expect(sql(`select has_table_privilege('${role}','public.integration_entity_leases','SELECT')`)).toBe(allowed)
      expect(sql(`select has_function_privilege('${role}','public.acquire_integration_entity_lease(text,text,uuid)','EXECUTE')`)).toBe(allowed)
      expect(sql(`select has_function_privilege('${role}','public.release_integration_entity_lease(text,text,uuid,uuid)','EXECUTE')`)).toBe(allowed)
      expect(sql(`select has_function_privilege('${role}','public.reopen_integration_workflow_job(text,text)','EXECUTE')`)).toBe(allowed)
    }
  })

  it('reopens only terminal exact-key Lawmatics jobs without inserting duplicate rows', () => {
    for (const status of ['succeeded', 'failed', 'running', 'pending']) {
      const key = `reopen-${status}`
      sql(`insert into public.workflow_jobs(job_type,dedupe_key,status,attempts,available_at,locked_at,locked_by,
        claim_token,lease_expires_at,last_error,completed_at) values ('lawmatics_sync_appointment','${key}','${status}',5,
        now()+interval '1 day',now(),'worker',gen_random_uuid(),now()+interval '2 minutes','safe failure',now())`)
      const terminal = ['succeeded', 'failed'].includes(status)
      expect(sql(`select public.reopen_integration_workflow_job('lawmatics_sync_appointment','${key}') is not null`))
        .toBe(terminal ? 't' : 'f')
      expect(sql(`select count(*) from public.workflow_jobs where dedupe_key='${key}'`)).toBe('1')
      if (terminal) {
        expect(sql(`select status='pending' and attempts=0 and available_at<=clock_timestamp() and locked_at is null
          and locked_by is null and claim_token is null and lease_expires_at is null and last_error is null
          and completed_at is null from public.workflow_jobs where dedupe_key='${key}'`)).toBe('t')
      } else {
        expect(sql(`select status='${status}' and attempts=5 and locked_by='worker' from public.workflow_jobs where dedupe_key='${key}'`)).toBe('t')
      }
    }
    sql("insert into public.workflow_jobs(job_type,dedupe_key,status) values ('annual_review','other-type','succeeded')")
    expect(sql("select public.reopen_integration_workflow_job('annual_review','other-type') is null")).toBe('t')
    expect(sql("select public.reopen_integration_workflow_job('lawmatics_sync_appointment','other-type') is null")).toBe('t')
    expect(sql("select public.reopen_integration_workflow_job('lawmatics_sync_appointment','missing-key') is null")).toBe('t')
    expect(sql("select status from public.workflow_jobs where dedupe_key='other-type'")).toBe('succeeded')
  })
})
