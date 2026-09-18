import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The client's questionnaire still saves — and still saves only their own row.
 *
 * 20261209000000_client_intake_writes_service_role_only.sql removed the RLS
 * policy that let a signed-in client write client_intake, because it placed no
 * restriction on which columns and so made the submitted/approved lock
 * advisory. That moves two burdens onto this route: it is now the only way in,
 * so it has to hold the service-role key; and RLS is no longer standing behind
 * its ownership check, so that check has to be right on its own.
 *
 * Both halves are asserted here. The route's other tests read its source text,
 * which cannot tell one Supabase client from the other.
 */

vi.mock('server-only', () => ({}))

type Call = { table: string; verb: string; values?: Record<string, unknown>; filters: string[] }

const state = vi.hoisted(() => ({
  /** Every statement, tagged with which client issued it. */
  asUser: [] as Call[],
  asServiceRole: [] as Call[],
  /** What the ownership-scoped SELECT finds. */
  existingRow: null as Record<string, unknown> | null,
  /** Rows the UPDATE reports as changed; [] is "not yours". */
  updatedRows: [{ id: 'intake-1' }] as Array<{ id: string }>,
  reset() {
    this.asUser = []
    this.asServiceRole = []
    this.existingRow = { id: 'intake-1', status: 'draft', user_id: 'user-1' }
    this.updatedRows = [{ id: 'intake-1' }]
  },
}))

/** A chainable, awaitable stand-in for the PostgREST builder. */
function builder(sink: Call[], table: string) {
  const call: Call = { table, verb: 'select', filters: [] }
  sink.push(call)

  const result = () => {
    if (call.verb === 'update') return { data: state.updatedRows, error: null }
    if (call.verb === 'insert') return { data: { id: 'intake-new' }, error: null }
    return { data: state.existingRow ? [state.existingRow] : [], error: null }
  }

  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    maybeSingle: async () => ({ data: state.existingRow, error: null }),
    single: async () => {
      const r = result()
      return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null }
    },
  }
  for (const verb of ['select', 'update', 'insert', 'upsert', 'delete'] as const) {
    chain[verb] = (values?: Record<string, unknown>) => {
      if (verb !== 'select') {
        call.verb = verb
        call.values = values
      }
      return chain
    }
  }
  for (const filter of ['eq', 'or', 'order', 'limit', 'in', 'is', 'neq', 'ilike'] as const) {
    chain[filter] = (...args: unknown[]) => {
      call.filters.push(`${filter}(${args.map(a => String(a)).join(',')})`)
      return chain
    }
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'client@example.com' } } }) },
    from: (table: string) => builder(state.asUser, table),
  }),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  ADMIN_EMAIL: 'firm@example.com',
  getAdminClient: () => ({ from: (table: string) => builder(state.asServiceRole, table) }),
}))

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts: vi.fn() }))
vi.mock('@/lib/syncLeadFromIntake', () => ({
  intakePayloadTouchesLead: () => false,
  syncLeadFromIntake: vi.fn(async () => {}),
}))
vi.mock('@/lib/intakeSeed', () => ({ seedDesignSheetAndJobs: vi.fn(async () => {}) }))

function save(body: Record<string, unknown>) {
  return new Request('https://portal.example.com/api/intake', {
    method: 'POST',
    headers: { authorization: 'Bearer client-jwt', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const writes = (calls: Call[]) =>
  calls.filter(c => c.table === 'client_intake' && c.verb !== 'select')

beforeEach(() => {
  state.reset()
  vi.clearAllMocks()
})

describe('an authenticated client saving their questionnaire', () => {
  it('writes through the service role, never through their own session', async () => {
    const { POST } = await import('@/app/api/intake/route')
    const response = await POST(save({ existingId: 'intake-1', first_name: 'Ada' }))

    expect(response.status).toBe(200)
    // The load-bearing assertion: with the RLS write policy gone, a write
    // issued as the user would match no rows and the save would silently
    // stop working.
    expect(writes(state.asUser)).toEqual([])
    expect(writes(state.asServiceRole).map(c => c.verb)).toContain('update')
  })

  it('keeps the ownership predicate on the statement itself', async () => {
    const { POST } = await import('@/app/api/intake/route')
    await POST(save({ existingId: 'intake-1', first_name: 'Ada' }))

    const update = writes(state.asServiceRole).find(c => c.verb === 'update')
    // RLS used to scope this write no matter what the route asked for. It does
    // not any more, so the row and the owner both have to be named here.
    expect(update?.filters).toContain('eq(id,intake-1)')
    expect(update?.filters.some(f => f.startsWith('or(') && f.includes('user-1'))).toBe(true)
  })

  it('refuses a row that is not theirs', async () => {
    state.updatedRows = []
    const { POST } = await import('@/app/api/intake/route')
    const response = await POST(save({ existingId: 'someone-elses', first_name: 'Ada' }))

    expect(response.status).toBe(403)
  })

  it('still refuses to touch a questionnaire the attorney already has', async () => {
    state.existingRow = { id: 'intake-1', status: 'submitted', user_id: 'user-1' }
    const { POST } = await import('@/app/api/intake/route')
    const response = await POST(save({ existingId: 'intake-1', first_name: 'Ada' }))

    expect(response.status).toBe(409)
    expect(writes(state.asServiceRole)).toEqual([])
  })
})
