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
 */

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    rpc: async () => ({ data: { id: null }, error: null }),
  }),
}))

vi.mock('@/lib/runs/reaper', () => ({
  reapAbandonedRuns: async () => ({ reaped: 0 }),
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
    expect(await res.json()).toEqual({ reaped: 0, claimedRunId: null, worked: 0, done: null })
  })
})
