import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PIPELINE_SLA_PHASES, SLA_PHASES } from '@/lib/slaTasks/types'
import { STAGES } from '@/types/database'

vi.mock('server-only', () => ({}))

/**
 * Booking a discovery call, through either writer.
 *
 * 20260910000000_lead_discovery_stage.sql moves a lead to the `discovery_call`
 * stage from a BEFORE trigger on `matters.discovery_call_at`, and four v3 tasks
 * hang off the same column. Both only ever fire for a writer that actually
 * writes it — which the Cal.com/Calendly webhook did not, and which the
 * scheduling page did without ever dating the tasks.
 */

const state = vi.hoisted(() => ({
  leadRow: null as { matter_id: string | null } | null,
  matterRows: [] as Array<{ id: string }>,
  /** What `discovery_call_at` holds when the code reads it back after writing. */
  storedDiscoveryCallAt: null as string | null,
  matterUpdates: [] as Array<Record<string, unknown>>,
  /** Columns passed to `.is(col, null)` — the write-once filter. */
  writeOnceFilters: [] as string[],
  anchorCalls: [] as Array<{ matterId: string; anchor: string; date: string }>,
  anchorResult: { ok: true, updated: 4 } as { ok: boolean; updated: number; error?: string },
  reset() {
    this.leadRow = null
    this.matterRows = []
    this.storedDiscoveryCallAt = null
    this.matterUpdates = []
    this.writeOnceFilters = []
    this.anchorCalls = []
    this.anchorResult = { ok: true, updated: 4 }
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
      // The read-back of the value that actually landed.
      maybeSingle: vi.fn(async () => ({
        data: { discovery_call_at: state.storedDiscoveryCallAt },
        error: null,
      })),
      update: vi.fn((values: Record<string, unknown>) => {
        state.matterUpdates.push(values)
        return {
          eq: vi.fn(() => {
            const settled = { error: null }
            return {
              is: vi.fn((column: string) => {
                state.writeOnceFilters.push(column)
                return Promise.resolve(settled)
              }),
              // Awaited directly when the write is unconditional.
              then: (onFulfilled: (value: { error: null }) => unknown) =>
                Promise.resolve(settled).then(onFulfilled),
            }
          }),
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

import { recordDiscoveryAnchor } from '@/lib/bookings/discoveryAnchor'
import { getAdminClient } from '@/lib/supabaseAdmin'

const admin = () => getAdminClient()
const MORNING = '2026-08-10T14:00:00.000Z'
const EVENING_ET = '2026-08-12T20:00:00-04:00'

beforeEach(() => {
  state.reset()
  vi.clearAllMocks()
})

describe('recordDiscoveryAnchor', () => {
  it('stamps discovery_call_at and dates the tasks waiting on it', async () => {
    state.storedDiscoveryCallAt = MORNING
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'matter-7',
      startIso: MORNING,
      overwrite: false,
    })
    expect(state.matterUpdates).toEqual([{ discovery_call_at: MORNING }])
    expect(state.anchorCalls).toEqual([
      { matterId: 'matter-7', anchor: 'discovery_call', date: '2026-08-10' },
    ])
  })

  it('is write-once on a first booking, so it cannot clobber an attorney date', async () => {
    state.storedDiscoveryCallAt = MORNING
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'm1',
      startIso: MORNING,
      overwrite: false,
    })
    expect(state.writeOnceFilters).toEqual(['discovery_call_at'])
  })

  it('overwrites on a reschedule, because the calendar is the truth', async () => {
    state.storedDiscoveryCallAt = MORNING
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'm1',
      startIso: MORNING,
      overwrite: true,
    })
    expect(state.writeOnceFilters).toEqual([])
    expect(state.matterUpdates).toHaveLength(1)
  })

  it('dates the tasks from the value that landed, not the one it offered', async () => {
    // Write-once, and an attorney already recorded a different day. The update
    // matches no rows; dating the plan from the booking day would leave the
    // tasks describing a call the column says happens a week earlier.
    state.storedDiscoveryCallAt = '2026-08-03T13:00:00.000Z'
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'm1',
      startIso: MORNING,
      overwrite: false,
    })
    expect(state.anchorCalls[0]?.date).toBe('2026-08-03')
  })

  it('resolves the lead-owned matter when there is no hired one', async () => {
    state.leadRow = { matter_id: 'matter-lead' }
    state.matterRows = [{ id: 'matter-lead' }]
    state.storedDiscoveryCallAt = MORNING
    await recordDiscoveryAnchor(admin(), {
      leadId: 'lead-1',
      matterId: null,
      startIso: MORNING,
      overwrite: false,
    })
    expect(state.anchorCalls[0]?.matterId).toBe('matter-lead')
  })

  it('anchors to the firm-timezone day, so an evening call is not tomorrow', async () => {
    state.storedDiscoveryCallAt = EVENING_ET
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'm1',
      startIso: EVENING_ET,
      overwrite: true,
    })
    expect(state.anchorCalls[0]?.date).toBe('2026-08-12')
  })

  it('does nothing when neither a lead nor a matter resolves', async () => {
    state.leadRow = { matter_id: null }
    state.matterRows = []
    await recordDiscoveryAnchor(admin(), {
      leadId: 'lead-1',
      matterId: null,
      startIso: MORNING,
      overwrite: false,
    })
    expect(state.matterUpdates).toHaveLength(0)
    expect(state.anchorCalls).toHaveLength(0)
  })

  it('writes nothing for a timestamp with no firm-timezone day', async () => {
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'm1',
      startIso: 'not-a-date',
      overwrite: true,
    })
    expect(state.matterUpdates).toHaveLength(0)
  })

  it('still stamps the anchor when the task reschedule fails', async () => {
    // The date is the fact worth keeping — it is what moves the stage. The
    // key-dates panel can always replay the scheduling.
    state.storedDiscoveryCallAt = MORNING
    state.anchorResult = { ok: false, updated: 0, error: 'boom' }
    await recordDiscoveryAnchor(admin(), {
      leadId: null,
      matterId: 'm1',
      startIso: MORNING,
      overwrite: true,
    })
    expect(state.matterUpdates).toHaveLength(1)
  })
})

/**
 * Both writers reach the anchor through the same function. Inlining either one
 * is how the webhook came to stamp `pmps` and nothing else.
 */
describe('every discovery-call writer routes through the shared anchor', () => {
  const sync = fs.readFileSync('lib/bookings/sync.ts', 'utf8')
  const book = fs.readFileSync('lib/appointments/book.ts', 'utf8')

  it('stamps from the Cal.com/Calendly webhook', () => {
    expect(sync).toContain("import { recordDiscoveryAnchor } from '@/lib/bookings/discoveryAnchor'")
    expect(sync).toContain(
      "if (eventKey === 'discovery_call' && startTime && (action === 'created' || action === 'rescheduled'))",
    )
    expect(sync).toContain("overwrite: action === 'rescheduled'")
  })

  it('stamps from the scheduling page', () => {
    expect(book).toContain(
      "import { recordDiscoveryAnchor } from '@/lib/bookings/discoveryAnchor'",
    )
    expect(book).toContain("overwrite: action === 'Rescheduled'")
    // The inlined update is gone, so there is only one place this can drift.
    expect(book).not.toContain('discovery_call_at: new Date(startIso).toISOString()')
  })

  it('leaves a cancelled or no-show call undated on both paths', () => {
    // The two tasks due at discovery_call+0 assume the conversation happened.
    expect(sync).not.toContain("eventKey === 'discovery_call' && (action === 'cancelled'")
    expect(book).toContain("(action === 'Booked' || action === 'Rescheduled')")
  })
})

/**
 * The pipeline had three orderings of the same two steps and one of them
 * disagreed. `stage_sla` was right; STAGES and pipeline_stage_rank moved onto
 * it. What is pinned here is that all three now agree, and that the rank ladder
 * stayed inert for the guards that read it.
 */
describe('revision precedes drafts_approved', () => {
  const rankSql = fs.readFileSync(
    'supabase/migrations/20260913000000_revision_before_drafts_approved.sql',
    'utf8',
  )
  const ranked = [...rankSql.matchAll(/when '([a-z_]+)'\s+then (\d+)/g)].map(match => ({
    stage: match[1],
    rank: Number(match[2]),
  }))

  it('orders the SQL ladder revision → drafts_approved', () => {
    const revision = ranked.find(entry => entry.stage === 'revision')?.rank
    const approved = ranked.find(entry => entry.stage === 'drafts_approved')?.rank
    expect(revision).toBeDefined()
    expect(approved).toBeDefined()
    expect(revision!).toBeLessThan(approved!)
  })

  it('stays strictly ascending, so no move that was forward becomes backward', () => {
    expect(ranked.every((entry, i) => i === 0 || entry.rank > ranked[i - 1].rank)).toBe(true)
  })

  it('keeps every stage the previous copy ranked, discovery_call included', () => {
    const previous = fs.readFileSync(
      'supabase/migrations/20260911000000_crm_discovery_stage_sync.sql',
      'utf8',
    )
    const previousStages = [
      ...previous
        .split('create or replace function public.pipeline_stage_rank(')[1]
        .split('$$;')[0]
        .matchAll(/when '([a-z_]+)'/g),
    ].map(match => match[1])
    // A stage dropped here would silently start returning null, which reads as
    // "unrecognised stage" and switches the guards off for it.
    expect(ranked.map(entry => entry.stage).sort()).toEqual(previousStages.sort())
    expect(ranked.map(entry => entry.stage)).toContain('discovery_call')
  })

  it('agrees with the app-side orderings', () => {
    const order = (list: readonly string[], key: string) => list.indexOf(key)
    expect(order(SLA_PHASES, 'revision')).toBeLessThan(order(SLA_PHASES, 'drafts_approved'))
    const stageKeys = STAGES.map(stage => stage.key)
    expect(order(stageKeys, 'revision')).toBeLessThan(order(stageKeys, 'drafts_approved'))
    // …and the ladder names exactly the phases the app knows.
    expect(ranked.map(entry => entry.stage).sort()).toEqual(
      [...PIPELINE_SLA_PHASES, 'discovery_call'].sort(),
    )
  })

  it('agrees with stage_sla, which had it right all along', () => {
    // stage_sla speaks engine keys: map_matter_stage_to_engine carries
    // revision → revisions and drafts_approved → approved.
    const seed = fs.readFileSync(
      'supabase/migrations/20260903000001_split_design_engine_stage.sql',
      'utf8',
    )
    const orderOf = (key: string) =>
      Number(
        seed.match(new RegExp(`'${key}',\\s*'DEFAULT',\\s*'matter',[^)]*?(\\d+)\\s*\\)`))?.[1],
      )
    expect(orderOf('revisions')).toBeLessThan(orderOf('approved'))
  })

  it('changes no guard: every rank comparison is against intake_completed', () => {
    // The swap is only safe because nothing compares two matter stages to each
    // other. If a future migration adds such a comparison, this catches it.
    for (const file of [
      'supabase/migrations/20260909000000_pmps_booking_lead_stage.sql',
      'supabase/migrations/20260911000000_crm_discovery_stage_sync.sql',
    ]) {
      const source = fs.readFileSync(file, 'utf8')
      const comparisons = [
        ...source.matchAll(/pipeline_stage_rank\('([a-z_]+)'\)/g),
      ].map(match => match[1])
      expect(new Set(comparisons)).toEqual(new Set(['intake_completed']))
    }
  })
})

describe('20260912000000 stage_entered_at search_path', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/20260912000000_stage_entered_at_search_path.sql',
    'utf8',
  )

  it('restores the pin that create-or-replace dropped', () => {
    expect(sql).toContain('create or replace function public.trg_matters_stage_entered_at()')
    expect(sql).toContain('set search_path = pg_catalog, public')
  })

  it('carries 20260910000000 behaviour over unchanged', () => {
    const discovery = fs.readFileSync(
      'supabase/migrations/20260910000000_lead_discovery_stage.sql',
      'utf8',
    )
    const bodyOf = (source: string) =>
      source
        .split('create or replace function public.trg_matters_stage_entered_at()')[1]
        .split('$$;')[0]
        .split('begin')
        .slice(1)
        .join('begin')
        .replace(/\s+/g, ' ')
        .trim()
    expect(bodyOf(sql)).toBe(bodyOf(discovery))
  })
})
