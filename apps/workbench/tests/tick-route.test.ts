import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/tick/route'

/**
 * The tick route's door — the three outcomes that matter before any run is
 * ever touched: no secret configured, the wrong secret, and the cron's own.
 *
 * Every other module the route calls is stubbed, so the "accepts" case does
 * no real work — no database, no model call. That is deliberate: this test
 * is only about the door. `claim_workflow_run` is stubbed to report nothing
 * queued (a full row of nulls, matching what the live database actually
 * returns — see the route's own comment on `claimed?.id == null`), so the
 * accepted request short-circuits before `workRun`, `loadRunContext` or the
 * model caller are ever reached.
 *
 * `callOrder` is shared between the `admin.rpc` stub and the
 * `materialiseStageTrigger` stub via `vi.hoisted` — a mock factory cannot
 * otherwise see a module-scope variable, since `vi.mock` calls are hoisted
 * above it — so the door test that cares about ordering can tell "claimed
 * before materialising" apart from the reverse, which no assertion on the
 * response body alone can do: both stubs return fixed values regardless of
 * when they were called.
 */

const callOrder = vi.hoisted(() => [] as string[])

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    rpc: async (name: string) => {
      callOrder.push(name)
      return { data: { id: null }, error: null }
    },
  }),
}))

vi.mock('@/lib/runs/reaper', () => ({
  reapAbandonedRuns: async () => ({ reaped: 0 }),
}))

vi.mock('@/lib/runs/triggers', () => ({
  materialiseStageTrigger: async () => {
    callOrder.push('materialiseStageTrigger')
    return { claimed: false, runId: null, status: null }
  },
}))

const ORIGINAL_SECRET = process.env.CRON_SECRET

describe('the tick route’s door', () => {
  afterEach(() => {
    // `delete process.env.CRON_SECRET` in the first test must not leak into
    // the ones after it.
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('refuses when the secret is not set', async () => {
    // A queue whose worker authenticates by accident is worse than one that
    // never runs. No secret means no, never "allow".
    delete process.env.CRON_SECRET
    const res = await GET(new Request('http://x/api/cron/tick'))
    expect(res.status).toBe(401)
  })

  it('refuses a wrong secret', async () => {
    process.env.CRON_SECRET = 'right'
    const res = await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('accepts the cron’s own header', async () => {
    process.env.CRON_SECRET = 'right'
    const res = await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer right' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reaped: 0,
      materialised: { claimed: false, runId: null, status: null },
      claimedRunId: null,
      worked: 0,
      done: null,
    })
  })

  it('materialises a pending trigger before claiming a run', async () => {
    // Order matters: materialising first means a trigger fired seconds ago
    // is worked by this same tick rather than waiting a minute for the next
    // one.
    process.env.CRON_SECRET = 'right'
    const res = await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer right' },
      }),
    )
    const body = await res.json()
    expect(body).toHaveProperty('materialised')
  })

  it('calls materialiseStageTrigger before claim_workflow_run, not after', async () => {
    // The property check above passes whichever order the two calls happen
    // in — both stubs return a fixed value no matter when they run. This is
    // the test that would actually notice the order being lost: a trigger
    // that fired a second ago is worked by *this* tick only if it is
    // materialised into a run before the claim below runs, not the next
    // minute's tick.
    callOrder.length = 0
    process.env.CRON_SECRET = 'right'
    await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer right' },
      }),
    )
    expect(callOrder).toEqual(['materialiseStageTrigger', 'claim_workflow_run'])
  })
})
