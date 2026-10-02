import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  admin: null as unknown,
  ensureMatterSlaTasks: vi.fn(),
  applySlaAnchor: vi.fn(),
  syncEngagementSignedDetails: vi.fn(),
  generateUniqueMatterNumber: vi.fn(),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))
vi.mock('@/lib/firmDate', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/firmDate')>()),
  firmTodayKey: () => '2026-10-02',
}))
vi.mock('@/lib/slaTasks/generate', () => ({
  ensureMatterSlaTasks: mocks.ensureMatterSlaTasks,
  applySlaAnchor: mocks.applySlaAnchor,
}))
vi.mock('@/lib/engagement/signedDate', () => ({ syncEngagementSignedDetails: mocks.syncEngagementSignedDetails }))
vi.mock('@/lib/matterNumber', () => ({ generateUniqueMatterNumber: mocks.generateUniqueMatterNumber }))
vi.mock('@/lib/intake/reconcileMatterIntakeTrack', () => ({ reconcileMatterIntakeTrack: vi.fn() }))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({ ensureDesignSheetSeededFromIntake: vi.fn() }))

import { POST } from '@/app/api/admin/matters/import/route'
import { detailsPatchFor, matterPatchFor, parseImportMatterBody, phasesBefore } from '@/lib/matters/importMatter'

/**
 * Bringing in a matter that began outside Cornerstone.
 *
 * The failure this exists to prevent: an imported client — signed years ago —
 * getting the new-client workflow, including plan nudges emailed about work
 * they finished long ago. So the tests are mostly about what does not happen.
 */

const MATTER = '11111111-1111-4111-8111-111111111111'
const TODAY = '2026-10-02'

interface Call { table: string; op: string; values?: Record<string, unknown>; filters: Array<[string, unknown[]]> }
let calls: Call[]
let rpcResult: { data: unknown; error: { code?: string; message: string } | null }
let matterUpdateError: { message: string } | null

function client() {
  return {
    rpc: vi.fn(async () => rpcResult),
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['eq', 'in']) chain[op] = (...args: unknown[]) => { call.filters.push([op, args]); return chain }
      chain.select = () => chain
      chain.maybeSingle = async () => ({ data: null, error: null })
      for (const op of ['update', 'upsert', 'insert']) {
        chain[op] = (values: Record<string, unknown>) => { call.op = op; call.values = values; return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'matters' && call.op === 'update' && matterUpdateError) {
          const error = matterUpdateError
          // Only the first write fails, like a column that is not there yet.
          if ('imported_at' in (call.values ?? {})) return Promise.resolve({ data: null, error }).then(resolve)
        }
        const data = table === 'tasks' && call.op === 'update' ? [{ id: 'a' }, { id: 'b' }] : null
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  }
}

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://test/api/admin/matters/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

const base = { clientName: 'Margaret Whitfield', clientEmail: 'mw@example.com', practiceArea: 'EP' }
const matterWrite = () => calls.find(c => c.table === 'matters' && c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'u1', user: { email: 'a@firm.com' } })
  mocks.admin = client()
  mocks.applySlaAnchor.mockResolvedValue({ ok: true, updated: 3 })
  mocks.syncEngagementSignedDetails.mockResolvedValue({ row: {}, error: null })
  mocks.generateUniqueMatterNumber.mockResolvedValue('2023-EP-WHITFIELD')
  calls = []
  rpcResult = { data: [{ matter_id: MATTER, matter_number: '2023-EP-WHITFIELD', created: true }], error: null }
  matterUpdateError = null
})

describe('importing a finished matter', () => {
  it('lands it closed, with its real dates, and generates no plan', async () => {
    const res = await post({
      ...base,
      stage: 'closed',
      dates: { openedOn: '2023-03-01', engagementSignedOn: '2023-03-08', signedOn: '2023-05-10', closedOn: '2023-07-01' },
    })

    expect(res.status).toBe(200)
    expect(mocks.ensureMatterSlaTasks).not.toHaveBeenCalled()
    expect(mocks.applySlaAnchor).not.toHaveBeenCalled()
    expect(matterWrite()?.values).toMatchObject({
      stage: 'closed',
      status: 'closed',
      closed_at: '2023-07-01T12:00:00Z',
      documents_executed_at: '2023-05-10T12:00:00Z',
      engagement_signed_at: '2023-03-08T12:00:00Z',
      hired_at: '2023-03-08T12:00:00Z',
      imported_at: expect.any(String),
    })
  })

  it('keeps the year the matter was opened in its generated number', async () => {
    await post({ ...base, stage: 'closed', dates: { openedOn: '2023-03-01' } })
    expect(mocks.generateUniqueMatterNumber).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ year: 2023 }))
  })

  it('records the engagement without replaying it as a clock', async () => {
    await post({ ...base, stage: 'closed', dates: { engagementSignedOn: '2023-03-08' } })
    expect(mocks.syncEngagementSignedDetails).toHaveBeenCalledWith(expect.anything(), MATTER, '2023-03-08T12:00:00.000Z')
    expect(mocks.applySlaAnchor).not.toHaveBeenCalled()
  })

  it('never uses the stage RPC, which fires the stage engine and billing milestones', async () => {
    await post({ ...base, stage: 'drafts_approved' })
    const rpc = (mocks.admin as { rpc: ReturnType<typeof vi.fn> }).rpc
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['create_matter_with_client'])
  })

  it('logs how it arrived', async () => {
    await post({ ...base, stage: 'closed' })
    const activity = calls.find(c => c.table === 'matter_activity')
    expect(activity?.values).toMatchObject({ event_type: 'matter_created', metadata: expect.objectContaining({ imported: true }) })
  })
})

describe('importing an in-progress matter with the remaining work planned', () => {
  it('dates what is left from today, not from an engagement years ago', async () => {
    await post({ ...base, stage: 'signing_scheduled', plan: 'remaining', dates: { engagementSignedOn: '2025-01-15' } })

    expect(mocks.ensureMatterSlaTasks).toHaveBeenCalledWith(MATTER, { practiceArea: 'EP' })
    expect(mocks.applySlaAnchor).toHaveBeenCalledWith(expect.anything(), MATTER, 'engagement', TODAY)
  })

  it('skips every plan phase before the current stage, and only plan tasks', async () => {
    const body = await (await post({ ...base, stage: 'signing_scheduled', plan: 'remaining' })).json()

    const skip = calls.find(c => c.table === 'tasks' && c.op === 'update')
    expect(skip?.values).toMatchObject({ status: 'archived', skipped_at: expect.any(String) })
    expect(skip?.filters).toContainEqual(['eq', ['source', 'sla']])
    const phases = skip?.filters.find(([op, args]) => op === 'in' && args[0] === 'phase')?.[1][1] as string[]
    expect(phases).toContain('drafting')
    expect(phases).toContain('drafts_approved')
    expect(phases).not.toContain('signing_scheduled')
    expect(body.skippedTasks).toBe(2)
  })
})

describe('what it refuses or tolerates', () => {
  it('rejects a date in the future — these are things that already happened', async () => {
    const res = await post({ ...base, stage: 'closed', dates: { signedOn: '2027-01-01' } })
    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('rejects a plan for a closed matter', async () => {
    expect((await post({ ...base, stage: 'closed', plan: 'remaining' })).status).toBe(400)
  })

  it('does nothing more when the same submission is retried', async () => {
    rpcResult = { data: [{ matter_id: MATTER, matter_number: 'X', created: false }], error: null }
    const body = await (await post({ ...base, stage: 'closed', requestId: '22222222-2222-4222-8222-222222222222' })).json()
    expect(body.created).toBe(false)
    expect(matterWrite()).toBeUndefined()
  })

  it('says so when a typed matter number is taken, rather than inventing another', async () => {
    rpcResult = { data: null, error: { code: '23505', message: 'duplicate' } }
    const res = await post({ ...base, stage: 'closed', matterNumber: 'EP-0042' })
    expect(res.status).toBe(409)
    expect(mocks.generateUniqueMatterNumber).not.toHaveBeenCalled()
  })

  it('still imports if the marker column has not been deployed yet', async () => {
    matterUpdateError = { message: "Could not find the 'imported_at' column of 'matters'" }
    const res = await post({ ...base, stage: 'closed' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.warnings).toHaveLength(1)
    const writes = calls.filter(c => c.table === 'matters' && c.op === 'update')
    expect(writes.at(-1)?.values).not.toHaveProperty('imported_at')
    expect(writes.at(-1)?.values).toMatchObject({ stage: 'closed' })
  })

  it('never writes without admin auth', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response('no', { status: 401 }) })
    expect((await post({ ...base, stage: 'closed' })).status).toBe(401)
    expect(calls).toEqual([])
  })
})

describe('the pure parts', () => {
  it('opens the current stage and everything after it', () => {
    expect(phasesBefore('intake')).toEqual(['new_lead', 'intake_sent', 'intake_completed', 'engagement_sent'])
    expect(phasesBefore('funding')).not.toContain('funding')
    expect(phasesBefore('funding')).toContain('signing_complete')
  })

  it('requires a closed stage for a closed date', () => {
    const parsed = parseImportMatterBody({ ...base, stage: 'funding', dates: { closedOn: '2024-01-01' } }, TODAY)
    expect(parsed.ok).toBe(false)
  })

  it('defaults to no plan', () => {
    const parsed = parseImportMatterBody({ ...base, stage: 'funding' }, TODAY)
    expect(parsed.ok && parsed.input.plan).toBe('none')
  })

  it('opens the fit gate, since the client is already engaged', () => {
    const parsed = parseImportMatterBody({ ...base, stage: 'design' }, TODAY)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(matterPatchFor(parsed.input, 'now')).toMatchObject({ fit_decision: 'fit', stage: 'design' })
    expect(matterPatchFor(parsed.input, 'now')).not.toHaveProperty('status')
  })

  it('puts the dates where the matter details panel reads them', () => {
    const parsed = parseImportMatterBody({
      ...base, stage: 'closed', notes: 'Drafted in WealthCounsel',
      dates: { signedOn: '2023-05-10', fundingCompletedOn: '2023-06-01', closedOn: '2023-07-01' },
    }, TODAY)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(detailsPatchFor(parsed.input)).toEqual({
      signing_date: '2023-05-10',
      execution_date: '2023-05-10',
      ep_funding_complete_date: '2023-06-01',
      closed_date: '2023-07-01',
      internal_notes: 'Drafted in WealthCounsel',
    })
  })
})
