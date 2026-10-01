import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applySlaAnchor } = vi.hoisted(() => ({ applySlaAnchor: vi.fn() }))

// The reschedule itself is covered by tests/sla-task-schedule.test.ts; here the
// boundary is what we hand it — the right clock, and the right calendar day.
vi.mock('@/lib/slaTasks/generate', () => ({ applySlaAnchor }))

import {
  ENGAGEMENT_SIGNED_TASK_TITLE,
  syncEngagementSignedAnchor,
  syncEngagementSignedDetails,
} from '@/lib/engagement/signedDate'

type Write = {
  table: string
  op: 'upsert' | 'update'
  payload: Record<string, unknown>
  filters?: Array<[string, unknown]>
}

/**
 * A minimal stand-in for the admin client: enough of the query builder to run
 * the real helper, and a log of every write so a test can assert the three
 * tables ended up agreeing.
 */
function fakeAdmin(seed: Record<string, Record<string, unknown> | null> = {}) {
  const writes: Write[] = []
  const from = (table: string) => {
    let pending: { op: 'upsert' | 'update'; payload: Record<string, unknown> } | null = null
    const result = () => ({
      data: pending ? { ...(seed[table] ?? {}), ...pending.payload } : seed[table] ?? null,
      error: null,
    })
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        const write = writes.find(w => w.table === table && w.op === pending?.op && w.payload === pending?.payload)
        if (write) (write.filters ??= []).push([column, value])
        return builder
      },
      maybeSingle: async () => ({ data: seed[table] ?? null, error: null }),
      single: async () => result(),
      upsert: (payload: Record<string, unknown>) => {
        pending = { op: 'upsert', payload }
        writes.push({ table, op: 'upsert', payload })
        return builder
      },
      update: (payload: Record<string, unknown>) => {
        pending = { op: 'update', payload }
        writes.push({ table, op: 'update', payload })
        return builder
      },
      // `await admin.from(t).update(p).eq(...)` awaits the builder itself.
      then: (resolve: (value: unknown) => unknown) => resolve(result()),
    }
    return builder
  }
  return { client: { from } as never, writes }
}

const writeTo = (writes: Write[], table: string) => writes.find(w => w.table === table)

beforeEach(() => {
  applySlaAnchor.mockReset()
  applySlaAnchor.mockResolvedValue({ ok: true, updated: 3 })
})

describe('syncEngagementSignedAnchor', () => {
  it('copies the signed stamp onto the matters clock column', () => {
    // matters.engagement_signed_at is a second home for the same fact; letting
    // it drift is what made the SLA plan and the Dates panel disagree.
    const { client, writes } = fakeAdmin()
    return syncEngagementSignedAnchor(client, 'matter-1', '2026-08-06T12:00:00.000Z').then(result => {
      expect(result.error).toBeNull()
      expect(writeTo(writes, 'matters')?.payload).toEqual({
        engagement_signed_at: '2026-08-06T12:00:00.000Z',
      })
    })
  })

  it('re-dates the tasks waiting on the engagement clock', async () => {
    const { client } = fakeAdmin()
    const result = await syncEngagementSignedAnchor(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    expect(applySlaAnchor).toHaveBeenCalledWith(client, 'matter-1', 'engagement', '2026-08-06')
    expect(result.rescheduled).toBe(3)
  })

  it('hands the reschedule the firm-timezone day, not the UTC one', async () => {
    // 02:00Z on the 7th is still 22:00 on the 6th in the firm's timezone.
    // Rescheduling off the UTC day would push every downstream deadline a day
    // late.
    const { client } = fakeAdmin()
    await syncEngagementSignedAnchor(client, 'matter-1', '2026-08-07T02:00:00.000Z')
    expect(applySlaAnchor).toHaveBeenCalledWith(client, 'matter-1', 'engagement', '2026-08-06')
  })

  it('clears the column without rescheduling anything', async () => {
    // There is no day to reschedule to. The tasks keep the dates they have
    // until a real date arrives.
    const { client, writes } = fakeAdmin()
    const result = await syncEngagementSignedAnchor(client, 'matter-1', null)
    expect(writeTo(writes, 'matters')?.payload).toEqual({ engagement_signed_at: null })
    expect(applySlaAnchor).not.toHaveBeenCalled()
    expect(result.rescheduled).toBe(0)
  })

  it('keeps the saved date when the reschedule fails', async () => {
    // The attorney asked to record a date. Losing it because a task could not
    // be re-dated would be the worse failure.
    applySlaAnchor.mockResolvedValueOnce({ ok: false, updated: 0, error: 'boom' } as never)
    const { client, writes } = fakeAdmin()
    const result = await syncEngagementSignedAnchor(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    expect(writeTo(writes, 'matters')).toBeDefined()
    expect(result.error).toBeNull()
    expect(result.rescheduled).toBe(0)
  })
})

describe('syncEngagementSignedDetails', () => {
  it('writes the signed date, flag and status together', async () => {
    const { client, writes } = fakeAdmin({ matter_details: { engagement_status: 'sent' } })
    const result = await syncEngagementSignedDetails(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    expect(result.error).toBeNull()
    expect(writeTo(writes, 'matter_details')?.payload).toMatchObject({
      client_id: 'matter-1',
      engagement_signed_at: '2026-08-06T12:00:00.000Z',
      engagement_signed: true,
      engagement_status: 'signed',
    })
  })

  it('mirrors the date onto the originating lead', async () => {
    const { client, writes } = fakeAdmin({
      matter_details: { engagement_status: 'sent' },
      matters: { client_intake_id: 'lead-9' },
    })
    await syncEngagementSignedDetails(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    expect(writeTo(writes, 'client_intake')?.payload).toMatchObject({
      engagement_signed_at: '2026-08-06T12:00:00.000Z',
      engagement_status: 'signed',
    })
  })

  it('skips the lead mirror for a matter with no originating lead', async () => {
    const { client, writes } = fakeAdmin({ matters: null })
    await syncEngagementSignedDetails(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    expect(writeTo(writes, 'client_intake')).toBeUndefined()
  })

  it('un-signs the engagement when the date is cleared', async () => {
    const { client, writes } = fakeAdmin({
      matter_details: { engagement_status: 'signed', engagement_sent_at: '2026-07-01T00:00:00Z' },
    })
    await syncEngagementSignedDetails(client, 'matter-1', null)
    expect(writeTo(writes, 'matter_details')?.payload).toMatchObject({
      engagement_signed_at: null,
      engagement_signed: false,
      engagement_status: 'sent',
    })
  })
})

describe('both write paths keep the two columns together', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

  it('the Dates panel save also moves the SLA clock', () => {
    const route = read('app/api/admin/matter-details/route.ts')
    expect(route).toContain('syncEngagementSignedAnchor')
    expect(route).toContain('syncEngagementSignedDetails')
  })

  it('an e-signed engagement moves the SLA clock too', () => {
    // E-signing is how most engagements get signed. If it were the one path
    // that skipped the anchor, the clock would be wrong for the common case.
    // The anchor now moves inside the shared completion module, which is what
    // every signing path — webhook or in-process — has to go through.
    const completion = read('lib/esign/completion.ts')
    expect(completion).toContain('syncEngagementSignedAnchor')
    const route = read('app/api/webhooks/esign/route.ts')
    expect(route).toContain('@/lib/esign/completion')
  })

  it('the SLA tab save also updates the matter details and the lead', () => {
    // Syncing one direction only would leave the Dates panel blank after an
    // attorney set the date on the SLA tab — the same divergence, mirrored.
    const route = read('app/api/admin/matters/[id]/sla-anchors/route.ts')
    expect(route).toContain('syncEngagementSignedDetails')
  })
})

/**
 * Ticking the checklist item the signed date completes.
 *
 * Measured 2026-09-10: of 24 hired matters with a signed date, four still had
 * "Client signs engagement agreement" open, and no unsigned matter did. The
 * item is ticked by hand and the hand sometimes misses.
 */
describe('the engagement checklist item', () => {
  it('is marked done when the date is recorded', async () => {
    const { client, writes } = fakeAdmin()
    await syncEngagementSignedAnchor(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    const tick = writes.find(w => w.table === 'tasks')
    expect(tick?.payload).toEqual({ status: 'done', completed_at: '2026-08-06T12:00:00.000Z' })
  })

  it('completes it as of the signing, not of now', () => {
    // A date recorded a fortnight late must not claim the work happened then.
    const { client, writes } = fakeAdmin()
    return syncEngagementSignedAnchor(client, 'matter-1', '2026-07-01T09:00:00.000Z').then(() => {
      expect(writes.find(w => w.table === 'tasks')?.payload.completed_at).toBe('2026-07-01T09:00:00.000Z')
    })
  })

  it('matches only this matter’s open sla row with this exact title', async () => {
    // phase `engagement_sent` also carries "Send engagement agreement" and
    // "Send recommendations + engagement agreement" — the firm's work, which
    // the client signing does not finish. And restricting to `open` is what
    // makes a second call change nothing.
    const { client, writes } = fakeAdmin()
    await syncEngagementSignedAnchor(client, 'matter-1', '2026-08-06T12:00:00.000Z')
    expect(writes.find(w => w.table === 'tasks')?.filters).toEqual([
      ['matter_id', 'matter-1'],
      ['source', 'sla'],
      ['title', ENGAGEMENT_SIGNED_TASK_TITLE],
      ['status', 'open'],
    ])
  })

  it('is left alone when the date is cleared', async () => {
    // Nothing on the row records that this closed it, so reopening would also
    // resurrect an item an attorney ticked by hand.
    const { client, writes } = fakeAdmin()
    await syncEngagementSignedAnchor(client, 'matter-1', null)
    expect(writes.find(w => w.table === 'tasks')).toBeUndefined()
  })

  it('still records the date when the tick cannot be written', async () => {
    const { client } = fakeAdmin()
    const failing = {
      from: (table: string) =>
        table === 'tasks'
          ? {
              update: () => failing.from('tasks'),
              eq: () => failing.from('tasks'),
              select: async () => ({ data: null, error: { message: 'tasks unavailable' } }),
            }
          : (client as unknown as { from: (t: string) => unknown }).from(table),
    }
    const result = await syncEngagementSignedAnchor(failing as never, 'matter-1', '2026-08-06T12:00:00.000Z')
    // The date is the thing the attorney asked to record.
    expect(result.error).toBeNull()
    expect(result.completed).toBe(0)
  })

  /**
   * The title is not defined in TypeScript — it is seeded into the SLA
   * templates. A rename there would leave the matcher silently ticking
   * nothing, with no failure anywhere.
   */
  it('matches the title every SLA seed actually uses', () => {
    for (const seed of [
      'supabase/migrations/20260824000001_estate_planning_sla_v3.sql',
      'supabase/migrations/20260922000000_college_prep_sla_v1.sql',
      'supabase/migrations/20270102090700_estate_planning_lp_sla_v1.sql',
    ]) {
      const sql = fs.readFileSync(path.join(process.cwd(), seed), 'utf8')
      expect(sql).toContain(`"name":"${ENGAGEMENT_SIGNED_TASK_TITLE}"`)
    }
  })
})
