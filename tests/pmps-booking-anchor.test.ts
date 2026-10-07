import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PIPELINE_SLA_PHASES } from '@/lib/slaTasks/types'

vi.mock('server-only', () => ({}))

/**
 * Booking a Peace of Mind Planning Session under the v3 SLA.
 *
 * The old model — PMPS = design meeting, held by a hired matter in `intake` —
 * left two holes once v3 moved the session before the engagement: the anchor
 * eleven tasks hang off was never written, and the stage advance guarded on
 * matter stages a lead never has.
 */

const state = vi.hoisted(() => ({
  leadRow: null as { matter_id: string | null } | null,
  matterRows: [] as Array<{ id: string }>,
  matterUpdates: [] as Array<Record<string, unknown>>,
  anchorCalls: [] as Array<{ matterId: string; anchor: string; date: string }>,
  anchorResult: { ok: true, updated: 3 } as { ok: boolean; updated: number; error?: string },
  reset() {
    this.leadRow = null
    this.matterRows = []
    this.matterUpdates = []
    this.anchorCalls = []
    this.anchorResult = { ok: true, updated: 3 }
  },
}))

vi.mock('@/lib/supabaseAdmin', () => {
  function builderFor(table: string) {
    if (table === 'client_intake') {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: state.leadRow, error: null })),
      }
      return chain
    }
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => ({ data: state.matterRows, error: null })),
      update: vi.fn((values: Record<string, unknown>) => {
        state.matterUpdates.push(values)
        return {
          eq: vi.fn(async () => ({ error: null })),
        }
      }),
    }
    return chain
  }
  return { getAdminClient: vi.fn(() => ({ from: vi.fn((table: string) => builderFor(table)) })) }
})

vi.mock('@/lib/slaTasks/generate', () => ({
  applySlaAnchor: vi.fn(async (_admin: unknown, matterId: string, anchor: string, date: string) => {
    state.anchorCalls.push({ matterId, anchor, date })
    return state.anchorResult
  }),
}))

import { findMatterIdByLeadId } from '@/lib/bookings/link'
import { recordPmpsAnchor } from '@/lib/bookings/pmpsAnchor'
import { rescheduleForAnchor } from '@/lib/slaTasks/schedule'
import { getAdminClient } from '@/lib/supabaseAdmin'

const admin = () => getAdminClient()
const EVENING_ET = '2026-08-12T20:00:00-04:00'

beforeEach(() => {
  state.reset()
  vi.clearAllMocks()
})

describe('findMatterIdByLeadId', () => {
  it('returns the matter the lead itself points at, not just the newest', async () => {
    state.leadRow = { matter_id: 'matter-older' }
    state.matterRows = [{ id: 'matter-newer' }, { id: 'matter-older' }]
    expect(await findMatterIdByLeadId(admin(), 'lead-1')).toBe('matter-older')
  })

  it('falls back to the most recent when the lead points nowhere', async () => {
    state.leadRow = { matter_id: null }
    state.matterRows = [{ id: 'matter-newer' }, { id: 'matter-older' }]
    expect(await findMatterIdByLeadId(admin(), 'lead-1')).toBe('matter-newer')
  })

  it('returns null when the lead has no matter', async () => {
    state.leadRow = { matter_id: null }
    state.matterRows = []
    expect(await findMatterIdByLeadId(admin(), 'lead-1')).toBeNull()
  })
})

describe('recordPmpsAnchor', () => {
  it('stamps pmps_at and re-dates the tasks waiting on it', async () => {
    await recordPmpsAnchor(admin(), {
      leadId: null,
      matterId: 'matter-7',
      startIso: '2026-08-10T14:00:00.000Z',
    })
    expect(state.matterUpdates).toEqual([{ pmps_at: '2026-08-10T14:00:00.000Z' }])
    expect(state.anchorCalls).toEqual([
      { matterId: 'matter-7', anchor: 'pmps', date: '2026-08-10' },
    ])
  })

  it('resolves the lead-owned matter when there is no hired one', async () => {
    state.leadRow = { matter_id: 'matter-lead' }
    state.matterRows = [{ id: 'matter-lead' }]
    await recordPmpsAnchor(admin(), {
      leadId: 'lead-1',
      matterId: null,
      startIso: '2026-08-10T14:00:00.000Z',
    })
    expect(state.anchorCalls[0]?.matterId).toBe('matter-lead')
  })

  it('prefers the hired matter over a lead lookup', async () => {
    state.leadRow = { matter_id: 'matter-lead' }
    await recordPmpsAnchor(admin(), {
      leadId: 'lead-1',
      matterId: 'matter-hired',
      startIso: '2026-08-10T14:00:00.000Z',
    })
    expect(state.anchorCalls[0]?.matterId).toBe('matter-hired')
    expect(state.matterUpdates).toHaveLength(1)
  })

  it('anchors to the firm-timezone day, so an evening session is not tomorrow', async () => {
    await recordPmpsAnchor(admin(), { leadId: null, matterId: 'm1', startIso: EVENING_ET })
    expect(state.anchorCalls[0]?.date).toBe('2026-08-12')
  })

  it('does nothing when neither a lead nor a matter resolves', async () => {
    state.leadRow = { matter_id: null }
    state.matterRows = []
    await recordPmpsAnchor(admin(), { leadId: 'lead-1', matterId: null, startIso: EVENING_ET })
    expect(state.matterUpdates).toHaveLength(0)
    expect(state.anchorCalls).toHaveLength(0)
  })

  it('still stamps the anchor when the task reschedule fails', async () => {
    // The date is the fact worth keeping; re-running the anchor from the
    // key-dates panel can always redo the scheduling.
    state.anchorResult = { ok: false, updated: 0, error: 'boom' }
    await recordPmpsAnchor(admin(), { leadId: null, matterId: 'm1', startIso: EVENING_ET })
    expect(state.matterUpdates).toHaveLength(1)
  })
})

/**
 * Cancelling a session deliberately leaves `pmps_at` — and the target signing
 * date — where they are. The behavioural half of this lives in
 * tests/appointment-booking.test.ts; what is pinned here is why the shape of the
 * surrounding code makes that the right call, so a later reader does not read
 * the omission as a gap.
 */
describe('a cancelled session keeps its anchor', () => {
  const book = fs.readFileSync('lib/appointments/book.ts', 'utf8')
  const route = fs.readFileSync('app/api/admin/matters/[id]/sla-anchors/route.ts', 'utf8')

  it('guards both key-date writes on the action, so a cancel writes neither', () => {
    expect(book).toContain("if (action !== 'Cancelled' && startIso && type.key === 'pmps')")
    expect(book).toContain(
      "if (action !== 'Cancelled' && startIso && type.key === 'signing_appointment')",
    )
  })

  it('agrees with the key-dates panel, where clearing a date does not undate the plan', () => {
    // The panel already answers "the anchor is gone": null the column and move
    // on, leaving the task dates alone. Undating them on cancel would make the
    // scheduler harsher than the attorney's own clear button.
    expect(route).toMatch(/patch\[config\.column\] = null\s*\n\s*continue/)
    expect(route).toContain('if (config.anchor) anchorsToApply.push')
  })

  it('has no undate mode to reuse: a non-date anchor reschedules nothing', () => {
    // Full rollback is not a flag on the existing path — `applySlaAnchor` can
    // only move dates to a real day, so nulling them would be new machinery.
    const task: Parameters<typeof rescheduleForAnchor>[0][number] = {
      id: 'task-1',
      status: 'open',
      relative_to: 'pmps',
      due_offset_days: -1,
      nudge_offset_days: -2,
      escalation_offset_days: 0,
      due_date: '2026-08-11',
      nudge_date: '2026-08-10',
      escalation_date: '2026-08-12',
    }
    expect(rescheduleForAnchor([task], 'pmps', '2026-08-20')).toHaveLength(1)
    expect(rescheduleForAnchor([task], 'pmps', '')).toEqual([])
  })
})

describe('20260909000000 pmps booking lead stage', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/20260909000000_pmps_booking_lead_stage.sql',
    'utf8',
  )

  it('ranks every stage the app knows, strictly ascending', () => {
    const ranked = [...sql.matchAll(/when '([a-z_]+)'\s+then (\d+)/g)].map(match => ({
      stage: match[1],
      rank: Number(match[2]),
    }))
    // Set, not sequence. This file is no longer where the order lives:
    // 20260911000000 added discovery_call and 20260913000000 put revision ahead
    // of drafts_approved, so the *current* ladder is asserted against
    // PIPELINE_SLA_PHASES in tests/discovery-booking-anchor.test.ts. What still has to
    // hold here is that this copy named every phase the app knew at the time.
    expect(ranked.map(entry => entry.stage).sort()).toEqual([...PIPELINE_SLA_PHASES].sort())
    // Strictly ascending, or "forward-only" would let a stage move backwards.
    expect(ranked.every((entry, i) => i === 0 || entry.rank > ranked[i - 1].rank)).toBe(true)
  })

  it('advances a lead only forward, and never a hired matter', () => {
    expect(sql).toContain('before update of pmps_at on public.matters')
    expect(sql).toContain("if new.relationship_status = 'hired' then")
    expect(sql).toContain("v_rank >= public.pipeline_stage_rank('intake_completed')")
    expect(sql).toContain("new.stage := 'intake_completed'")
  })

  it('pins the stage clock to the session date, not the booking moment', () => {
    expect(sql).toContain('new.stage_entered_at := new.pmps_at')
    // …which only holds because the stage_entered_at trigger stopped
    // overwriting a value its caller deliberately supplied.
    expect(sql).toContain('new.stage_entered_at is not distinct from old.stage_entered_at')
  })

  it('stops the lead-timestamp derivation from undoing the move', () => {
    expect(sql).toContain('create or replace function public.ensure_lead_matter()')
    expect(sql).toContain('select m.id, m.pmps_at into v_matter_id, v_pmps_at')
    expect(sql).toMatch(/if v_pmps_at is not null[\s\S]*v_stage := 'intake_completed'/)
  })

  it('backfills sessions already booked, through both the lead and matter links', () => {
    expect(sql).toContain('on m.id = a.linked_matter_id')
    expect(sql).toContain('or m.client_intake_id = a.linked_lead_id')
    expect(sql).toContain('and m.pmps_at is null')
    // Task dating mirrors rescheduleForAnchor: open tasks, firm-timezone day.
    expect(sql).toContain("t.relative_to = 'pmps'")
    expect(sql).toContain("t.status in ('pending', 'active', 'blocked')")
    expect(sql).toContain("(m.pmps_at at time zone 'America/New_York')::date")
  })

  it('lets the key-dates panel log the activity it has always tried to write', () => {
    expect(sql).toContain("'sla_anchor_set'")
  })
})
