import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatterTaskRow } from '@/lib/slaTasks/types'

/**
 * Executed-handler tests for PATCH /api/matters/[matterId]/tasks/[taskId].
 *
 * The clock-pause rules are the part of the SLA system that quietly moves dates
 * a client has already been told about, so the arithmetic is pinned here rather
 * than left to the UI to demonstrate.
 */

const MATTER_ID = 'matter-1'

function task(overrides: Partial<MatterTaskRow> = {}): MatterTaskRow {
  return {
    id: 'task-a',
    matter_id: MATTER_ID,
    template_id: 'template-1',
    phase: 'onboarding',
    name: 'Client returns questionnaire & documents',
    sort_order: 3,
    assignee: 'client',
    skill: null,
    conditional: false,
    pauses_clock: true,
    start_date: '2026-03-01',
    due_date: '2026-03-08',
    nudge_date: '2026-03-06',
    nudge_tier: 'gentle',
    escalation_date: null,
    escalation_tier: null,
    due_offset_days: 7,
    nudge_offset_days: 5,
    escalation_offset_days: null,
    relative_to: null,
    pre_engagement: false,
    auto: false,
    gate: null,
    extends_target_days: null,
    recurring_interval_days: null,
    variant: null,
    triggers_day_zero: false,
    status: 'pending',
    completed_at: null,
    skipped_at: null,
    notes: null,
    paused_at: null,
    total_paused_days: 0,
    nudge_sent_at: null,
    escalation_sent_at: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

/** Every `update()` the handler issued, in order, with the row it targeted. */
const updates: { id: string | null; patch: Record<string, unknown> }[] = []
let currentTask: MatterTaskRow = task()
let siblings: MatterTaskRow[] = []

/**
 * Enough of the PostgREST builder to drive this route: filters chain and are
 * recorded, `maybeSingle`/`single` resolve the row, and a bare awaited chain
 * resolves like a fire-and-forget update.
 */
function builder() {
  const filters: Record<string, unknown> = {}
  let patch: Record<string, unknown> | null = null

  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters[column] = value
      return chain
    },
    update: (values: Record<string, unknown>) => {
      patch = values
      updates.push({ id: (filters.id as string) ?? null, patch: values })
      return chain
    },
    maybeSingle: async () => ({ data: currentTask, error: null }),
    single: async () => {
      backfillId()
      return { data: { ...currentTask, ...(patch ?? {}) }, error: null }
    },
    then: (resolve: (value: { data: null; error: null }) => unknown) => {
      backfillId()
      return Promise.resolve({ data: null, error: null }).then(resolve)
    },
  }

  // `update()` runs before the `eq()` that names the row, so the recorded entry
  // learns its id when the chain is finally resolved.
  function backfillId() {
    const recorded = updates.find(entry => entry.patch === patch)
    if (recorded && !recorded.id) recorded.id = (filters.id as string) ?? null
  }

  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => builder() }),
  ADMIN_EMAIL: 'admin@example.invalid',
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: async () => ({ err: null, userId: 'attorney-1', user: null }),
}))

vi.mock('@/lib/slaTasks/queries', () => ({
  fetchMatterTasks: async () => siblings,
}))

vi.mock('@/lib/firmDate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/firmDate')>()
  return { ...actual, firmTodayKey: () => '2026-03-14' }
})

type PatchHandler = typeof import('@/app/api/matters/[matterId]/tasks/[taskId]/route')['PATCH']

let PATCH: PatchHandler

beforeAll(async () => {
  ;({ PATCH } = await import('@/app/api/matters/[matterId]/tasks/[taskId]/route'))
})

function request(body: unknown) {
  return new Request('http://localhost/api/matters/matter-1/tasks/task-a', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ matterId: MATTER_ID, taskId: 'task-a' })

beforeEach(() => {
  updates.length = 0
  currentTask = task()
  siblings = []
  vi.setSystemTime(new Date('2026-03-14T15:00:00Z'))
})

describe('PATCH matter task', () => {
  it('completing a clock-pausing task late pushes the open tasks after it', async () => {
    siblings = [
      task({ id: 'task-a', sort_order: 3, status: 'completed' }),
      task({
        id: 'task-b',
        sort_order: 4,
        due_date: '2026-03-11',
        nudge_date: '2026-03-10',
        pauses_clock: false,
      }),
      task({ id: 'task-c', sort_order: 5, due_date: '2026-03-15', status: 'skipped' }),
    ]

    const res = await PATCH(request({ status: 'completed' }), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    // Due 2026-03-08, landed 2026-03-14 → six days of slip.
    expect(body.shiftedDays).toBe(6)
    expect(body.shifted).toEqual([
      { id: 'task-b', due_date: '2026-03-17', nudge_date: '2026-03-16', escalation_date: null },
    ])

    const own = updates[0].patch
    expect(own.status).toBe('completed')
    expect(own.total_paused_days).toBe(6)
    // The skipped task keeps its historical date.
    expect(updates.map(entry => entry.id)).toEqual(['task-a', 'task-b'])
  })

  it('does not move anything when a clock-pausing task lands on time', async () => {
    currentTask = task({ due_date: '2026-03-20' })
    siblings = [currentTask, task({ id: 'task-b', sort_order: 4, due_date: '2026-03-25' })]

    const body = await (await PATCH(request({ status: 'completed' }), { params })).json()

    expect(body.shiftedDays).toBe(0)
    expect(body.shifted).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0].patch.total_paused_days).toBeUndefined()
  })

  it('a task with pauses_clock false never shifts the plan, however late it is', async () => {
    currentTask = task({ pauses_clock: false })
    siblings = [currentTask, task({ id: 'task-b', sort_order: 4 })]

    const body = await (await PATCH(request({ status: 'completed' }), { params })).json()

    expect(body.shiftedDays).toBe(0)
    expect(body.shifted).toEqual([])
  })

  it('resuming charges the days parked and moves the task itself too', async () => {
    currentTask = task({ status: 'blocked', paused_at: '2026-03-10T12:00:00Z' })
    siblings = [
      task({ id: 'task-a', sort_order: 3, status: 'active', due_date: '2026-03-08' }),
      task({ id: 'task-b', sort_order: 4, due_date: '2026-03-11', nudge_date: null }),
    ]

    const body = await (await PATCH(request({ paused: false }), { params })).json()

    // Paused 2026-03-10, resumed 2026-03-14 → four days.
    expect(body.shiftedDays).toBe(4)
    expect(updates[0].patch).toMatchObject({
      paused_at: null,
      status: 'active',
      total_paused_days: 4,
    })
    expect(body.shifted).toEqual([
      { id: 'task-a', due_date: '2026-03-12', nudge_date: '2026-03-10', escalation_date: null },
      { id: 'task-b', due_date: '2026-03-15', nudge_date: null, escalation_date: null },
    ])
  })

  it('pausing parks the task without moving any dates', async () => {
    const body = await (await PATCH(request({ paused: true }), { params })).json()

    expect(body.shiftedDays).toBe(0)
    expect(updates[0].patch).toMatchObject({ status: 'blocked', paused_at: expect.any(String) })
  })

  it('resuming and completing in one call bills the pause once', async () => {
    currentTask = task({ status: 'blocked', paused_at: '2026-03-10T12:00:00Z' })
    siblings = [currentTask, task({ id: 'task-b', sort_order: 4, due_date: '2026-03-11' })]

    const body = await (
      await PATCH(request({ paused: false, status: 'completed' }), { params })
    ).json()

    // Six days late, not six plus the four it sat paused.
    expect(body.shiftedDays).toBe(6)
    expect(updates[0].patch.total_paused_days).toBe(6)
  })

  it('saves a note without touching status or dates', async () => {
    const body = await (await PATCH(request({ notes: '  waiting on the deed  ' }), { params })).json()

    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toEqual({ notes: 'waiting on the deed' })
    expect(body.shifted).toEqual([])
  })

  it('rejects an unknown status', async () => {
    const res = await PATCH(request({ status: 'finished' }), { params })
    expect(res.status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})
