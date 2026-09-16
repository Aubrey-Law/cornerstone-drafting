import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), settings: vi.fn(), scheduling: vi.fn(),
  createProspect: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), cancelEvent: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/integrations/settings', () => ({ getIntegrationSettings: mocks.settings }))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: mocks.scheduling }))
vi.mock('@/lib/integrations/lawmatics/client', () => ({ createLawmaticsProspect: mocks.createProspect,
  createLawmaticsEvent: mocks.createEvent, updateLawmaticsEvent: mocks.updateEvent, cancelLawmaticsEvent: mocks.cancelEvent }))
import { syncLawmaticsAppointment } from '@/lib/integrations/lawmatics/appointments'
import { reconcileLawmaticsAppointments } from '@/lib/integrations/lawmatics/reconcile'
import { GET } from '@/app/api/cron/scheduler-integrations/route'

type Row = Record<string, unknown>
let db: Record<string, Row[]>
let jobs: Map<string, Row>
let scans: Array<{ limit: number; after: unknown; order: string[] }>
let writes: number
let settings: { lawmaticsAppointmentSyncEnabled: boolean; lawmaticsEventTypeIdMap: Record<string, string>;
  lawmaticsLocationIdMap: Record<string, string>; lawmaticsUserIds: string[] }
const appointment = () => db.appointments[0]
const event = () => db.integration_external_records.find(row => row.external_record_type === 'event')!

// Stateful persistence boundary keeps the real canonical sync, record repository,
// enqueue dedupe, and reconciler connected without a provider or database service.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let projection = '*'
  let limit = Infinity
  const order: Array<{ key: string; ascending: boolean }> = []
  let after: unknown
  let patch: Row | undefined
  let insertion: Row | undefined
  const project = (row: Row) => projection === '*' ? { ...row }
    : Object.fromEntries(projection.split(',').map(key => [key.trim(), row[key.trim()]]))
  const rows = () => (db[table] ?? []).filter(row => filters.every(filter => filter(row)))
    .sort((a, b) => {
      for (const { key, ascending } of order) {
        const compared = String(a[key]).localeCompare(String(b[key]))
        if (compared) return ascending ? compared : -compared
      }
      return 0
    }).slice(0, limit)
  const q = {
    select: (fields = '*') => { projection = fields; return q },
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
    gt: (key: string, value: unknown) => { after = value; filters.push(row => String(row[key]) > String(value)); return q },
    or: (expression: string) => {
      const matched = expression.match(/^updated_at.lt.(.+),and\(updated_at.eq.(.+),id.lt.(.+)\)$/)
      if (!matched || matched[1] !== matched[2]) throw new Error('Invalid keyset predicate')
      after = expression
      filters.push(row => String(row.updated_at) < matched[1]
        || (row.updated_at === matched[1] && String(row.id) < matched[3]))
      return q
    },
    order: (key: string, options: { ascending: boolean }) => { order.push({ key, ...options }); return q },
    limit: (value: number) => { limit = value; return q },
    update: (value: Row) => { writes++; patch = value; return q },
    upsert: (value: Row) => { writes++; insertion = value; return q },
    maybeSingle: async () => {
      if (insertion) {
        const keys = ['provider', 'internal_entity_type', 'internal_entity_id', 'external_record_type']
        if ((db[table] ?? []).some(row => keys.every(key => row[key] === insertion![key]))) return { data: null, error: null }
        const created = { id: `record-${db[table].length}`, external_id: null, last_attempt_at: null,
          last_error_code: null, last_succeeded_at: null, metadata: {}, ...insertion }
        db[table].push(created)
        return { data: project(created), error: null }
      }
      const row = rows()[0]
      if (row && patch) Object.assign(row, patch)
      return { data: row ? project(row) : null, error: null }
    },
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
      if (table === 'appointments') scans.push({ limit, after, order: order.map(item => item.key) })
      return Promise.resolve(resolve({ data: rows().map(project), error: null }))
    },
  }
  return q
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  jobs = new Map()
  scans = []
  writes = 0
  db = {
    appointments: [{ id: 'appointment-001', source: 'public', status: 'scheduled', appointment_type_id: 'type-1',
      linked_lead_id: 'lead-1', linked_matter_id: null, location_type: 'phone',
      start_time: '2026-09-20T14:00:00Z', end_time: '2026-09-20T15:00:00Z', updated_at: '2026-09-15T12:00:00Z',
      notes: 'PRIVATE-NOTES', manage_token_hash: 'SECRET-TOKEN' }],
    appointment_types: [{ id: 'type-1', key: 'discovery', label: 'Discovery', location_type: 'phone' }],
    client_intake: [{ id: 'lead-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test',
      phone: null, lawmatics_matter_id: 'legacy-prospect' }],
    matters: [{ id: 'matter-1', client_intake_id: 'lead-1' }],
    integration_external_records: [],
  }
  settings = { lawmaticsAppointmentSyncEnabled: true, lawmaticsEventTypeIdMap: { discovery: 'type-provider' },
    lawmaticsLocationIdMap: { phone: 'phone-provider' }, lawmaticsUserIds: ['user-1'] }
  mocks.settings.mockImplementation(async () => settings)
  mocks.scheduling.mockResolvedValue({ timezone: 'America/New_York' })
  mocks.from.mockImplementation(query)
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'enqueue_workflow_job') {
      const key = args.p_dedupe_key as string
      if (!jobs.has(key)) jobs.set(key, { ...args, status: 'queued' })
      return { data: jobs.get(key), error: null }
    }
    if (name === 'reopen_integration_workflow_job') {
      const job = jobs.get(args.p_dedupe_key as string)
      if (job) job.status = 'queued'
      return { data: 'job-1', error: null }
    }
    throw new Error('Unexpected RPC')
  })
  mocks.createProspect.mockResolvedValue({ id: 'created-prospect' })
  mocks.createEvent.mockResolvedValue({ id: 'event-provider' })
  mocks.updateEvent.mockResolvedValue({ id: 'event-provider' })
})

describe('Lawmatics appointment reconciliation', () => {
  it('checks enablement before any source read or enqueue', async () => {
    settings.lawmaticsAppointmentSyncEnabled = false
    await expect(reconcileLawmaticsAppointments(100)).resolves.toEqual({ scanned: 0, enqueued: 0 })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(jobs.size).toBe(0)
  })

  it('selects native sources in ordered bounded keyset batches and caps total scanning at 100', async () => {
    const seed = { ...appointment() }
    db.appointments = Array.from({ length: 125 }, (_, index) => ({ ...seed,
      id: `appointment-${String(index).padStart(3, '0')}`, source: ['public', 'portal', 'admin'][index % 3] })).reverse()
    db.appointments.unshift({ ...seed, id: 'appointment-000-calendly', source: 'calendly' })
    await expect(reconcileLawmaticsAppointments(10000)).resolves.toEqual({ scanned: 100, enqueued: 100 })
    expect(jobs.size).toBe(100)
    expect([...jobs.values()].some(job => JSON.stringify(job).includes('calendly'))).toBe(false)
    expect(scans.length).toBeGreaterThan(1)
    expect(scans.every(scan => scan.limit <= 100 && scan.order.includes('id'))).toBe(true)
    expect(scans.slice(1).every(scan => typeof scan.after === 'string')).toBe(true)
  })

  it('prioritizes recently changed appointments and keysets across timestamp ties', async () => {
    const seed = { ...appointment() }
    db.appointments = Array.from({ length: 60 }, (_, index) => ({ ...seed,
      id: `appointment-${String(index).padStart(3, '0')}`,
      updated_at: index < 30 ? '2026-09-14T12:00:00Z' : '2026-09-15T12:00:00Z' }))
    await expect(reconcileLawmaticsAppointments(40)).resolves.toEqual({ scanned: 40, enqueued: 40 })
    const ids = [...jobs.values()].map(job => (job.p_payload as Row).appointmentId)
    expect(ids.slice(0, 3)).toEqual(['appointment-059', 'appointment-058', 'appointment-057'])
    expect(ids.at(-1)).toBe('appointment-020')
    expect(new Set(ids).size).toBe(40)
  })

  it.each([0, -1, NaN])('does not scan for an invalid or zero limit %s', async limit => {
    await expect(reconcileLawmaticsAppointments(limit)).resolves.toEqual({ scanned: 0, enqueued: 0 })
    expect(scans).toEqual([])
  })

  it('enqueues missing state without creating a Prospect, Event, or persistence mapping', async () => {
    db.client_intake[0].lawmatics_matter_id = null
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 1 })
    expect(writes).toBe(0)
    expect(db.integration_external_records).toEqual([])
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('skips the exact canonical version saved by appointment synchronization', async () => {
    await syncLawmaticsAppointment('appointment-001')
    vi.clearAllMocks()
    writes = 0
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 0 })
    expect(writes).toBe(0)
    expect(mocks.createProspect).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
    expect(mocks.updateEvent).not.toHaveBeenCalled()
  })

  it.each(['eventType', 'location', 'users', 'timezone', 'prospect', 'start', 'cancellation'])(
    'queues a distinct canonical delivery after a changed %s, then converges', async change => {
      await syncLawmaticsAppointment('appointment-001')
      const original = event().source_version
      if (change === 'eventType') settings.lawmaticsEventTypeIdMap.discovery = 'new-type'
      if (change === 'location') settings.lawmaticsLocationIdMap.phone = 'new-location'
      if (change === 'users') settings.lawmaticsUserIds = ['user-2']
      if (change === 'timezone') mocks.scheduling.mockResolvedValue({ timezone: 'UTC' })
      if (change === 'prospect') db.integration_external_records.find(row => row.external_record_type === 'prospect')!.external_id = 'new-prospect'
      if (change === 'start') appointment().start_time = '2026-09-22T14:00:00Z'
      if (change === 'cancellation') appointment().status = 'cancelled'
      await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 1 })
      const queued = [...jobs.values()][0]
      await syncLawmaticsAppointment('appointment-001')
      expect(event().source_version).not.toBe(original)
      expect(queued.p_payload).toMatchObject({ sourceVersion: event().source_version })
      await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 0 })
    })

  it('uses verified same-intake legacy identity and preserves lead/matter conflict checks without writes', async () => {
    await syncLawmaticsAppointment('appointment-001')
    db.integration_external_records = db.integration_external_records.filter(row => row.external_record_type === 'event')
    writes = 0
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 0 })
    appointment().linked_matter_id = 'matter-1'
    db.matters[0].client_intake_id = 'different-lead'
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 1 })
    expect(writes).toBe(0)
  })

  it('repairs pending state and skips unresolved attention even when appointment changes', async () => {
    await syncLawmaticsAppointment('appointment-001')
    event().status = 'pending'
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 1 })
    event().status = 'attention'
    appointment().start_time = '2026-09-25T14:00:00Z'
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 0 })
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'reopen_integration_workflow_job')).toHaveLength(0)
  })

  it('reopens only the matching disabled delivery, never unrelated terminal work', async () => {
    await syncLawmaticsAppointment('appointment-001')
    event().status = 'pending'
    await reconcileLawmaticsAppointments(10)
    const job = [...jobs.values()][0]
    job.status = 'succeeded'
    jobs.set('unrelated', { status: 'succeeded' })
    event().status = 'disabled'
    await expect(reconcileLawmaticsAppointments(10)).resolves.toEqual({ scanned: 1, enqueued: 1 })
    expect(job.status).toBe('queued')
    expect(jobs.get('unrelated')!.status).toBe('succeeded')
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'reopen_integration_workflow_job')).toEqual([
      ['reopen_integration_workflow_job', { p_job_type: 'lawmatics_sync_appointment', p_dedupe_key: job.p_dedupe_key }],
    ])
  })
})

describe('scheduler integrations cron boundary', () => {
  it.each([undefined, '', 'Bearer wrong', 'Bearer incorre', 'Bearer correct-extra', 'Bearer cörréct', 'Basic correct'])(
    'rejects unauthorized credentials without scanning (%s)', async authorization => {
      vi.stubEnv('CRON_SECRET', 'correct')
      const response = await GET(new Request('https://example.test/api/cron/scheduler-integrations', {
        headers: authorization === undefined ? {} : { authorization },
      }))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
      expect(mocks.from).not.toHaveBeenCalled()
    })

  it('fails closed when CRON_SECRET is missing', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const response = await GET(new Request('https://example.test', { headers: { authorization: 'Bearer ' } }))
    expect(response.status).toBe(401)
  })

  it('returns only provider aggregate counts', async () => {
    vi.stubEnv('CRON_SECRET', 'correct')
    const response = await GET(new Request('https://example.test', { headers: { authorization: 'Bearer correct' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ lawmatics: { scanned: 1, enqueued: 1 } })
  })

  it('sanitizes failures without serializing or logging source/provider details', async () => {
    vi.stubEnv('CRON_SECRET', 'correct')
    mocks.settings.mockRejectedValueOnce(new Error('PRIVATE-APPOINTMENT SECRET-TOKEN PROVIDER-SNAPSHOT'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await GET(new Request('https://example.test', { headers: { authorization: 'Bearer correct' } }))
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Reconciliation unavailable' })
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
})
