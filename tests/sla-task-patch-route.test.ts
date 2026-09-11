import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toPlanTask } from '@/lib/slaTasks/plan'
import type { PlanTask } from '@/lib/slaTasks/types'
import type { TaskRow, TaskStatus } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

/**
 * Executed-handler tests for PATCH /api/matters/[matterId]/tasks/[taskId].
 *
 * The clock-pause rules are the part of the plan that quietly moves dates a
 * client has already been told about, so the arithmetic is pinned here rather
 * than left to the UI to demonstrate.
 */

const MATTER_ID = 'matter-1'

/** A plan day, as `tasks` stores it. See lib/slaTasks/plan.ts. */
function at(dateKey: string | null): string | null {
  return dateKey ? `${dateKey}T12:00:00.000Z` : null
}

/**
 * Plan-shaped overrides, since that is the vocabulary these cases are written
 * in; the fixture converts them to the timestamp columns the row actually has.
 */
interface PlanOverrides {
  id?: string
  sort_order?: number
  status?: TaskStatus
  skipped_at?: string | null
  paused_at?: string | null
  pauses_clock?: boolean
  due_date?: string | null
  nudge_date?: string | null
  escalation_date?: string | null
}

function task(overrides: PlanOverrides = {}): TaskRow {
  const { due_date = '2026-03-08', nudge_date = '2026-03-06', escalation_date = null, ...rest } =
    overrides
  return taskFixture({
    id: 'task-a',
    matter_id: MATTER_ID,
    source: 'sla',
    plan_template_id: 'template-1',
    phase: 'onboarding',
    title: 'Client returns questionnaire & documents',
    sort_order: 3,
    owner: 'client',
    pauses_clock: true,
    plan_start_date: '2026-03-01',
    due_at: at(due_date),
    hard_due_at: at(due_date),
    nudge_at: at(nudge_date),
    nudge_tier: 'gentle',
    escalation_at: at(escalation_date),
    due_offset_days: 7,
    nudge_offset_days: 5,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...rest,
  })
}

/** The same row as the plan sees it — what `fetchPlanTasks` hands the handler. */
function plan(overrides: PlanOverrides = {}): PlanTask {
  return toPlanTask(task(overrides))
}

/** Archived because it did not apply, which is how the plan spells "skipped". */
const SKIPPED = { status: 'archived' as const, skipped_at: '2026-03-04T00:00:00Z' }

/** Every `update()` the handler issued, in order, with the row it targeted. */
const updates: { id: string | null; patch: Record<string, unknown> }[] = []
let currentTask: TaskRow = task()
let siblings: PlanTask[] = []

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
  fetchPlanTasks: async () => siblings,
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
      plan({ id: 'task-a', sort_order: 3, status: 'done' }),
      plan({
        id: 'task-b',
        sort_order: 4,
        due_date: '2026-03-11',
        nudge_date: '2026-03-10',
        pauses_clock: false,
      }),
      plan({ id: 'task-c', sort_order: 5, due_date: '2026-03-15', ...SKIPPED }),
    ]

    const res = await PATCH(request({ status: 'done' }), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    // Due 2026-03-08, landed 2026-03-14 → six days of slip.
    expect(body.shiftedDays).toBe(6)
    expect(body.shifted).toEqual([
      { id: 'task-b', due_date: '2026-03-17', nudge_date: '2026-03-16', escalation_date: null },
    ])

    const own = updates[0].patch
    expect(own.status).toBe('done')
    expect(own.total_paused_days).toBe(6)
    // The skipped task keeps its historical date.
    expect(updates.map(entry => entry.id)).toEqual(['task-a', 'task-b'])
  })

  it('does not move anything when a clock-pausing task lands on time', async () => {
    currentTask = task({ due_date: '2026-03-20' })
    siblings = [
      plan({ due_date: '2026-03-20' }),
      plan({ id: 'task-b', sort_order: 4, due_date: '2026-03-25' }),
    ]

    const body = await (await PATCH(request({ status: 'done' }), { params })).json()

    expect(body.shiftedDays).toBe(0)
    expect(body.shifted).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0].patch.total_paused_days).toBeUndefined()
  })

  it('a task with pauses_clock false never shifts the plan, however late it is', async () => {
    currentTask = task({ pauses_clock: false })
    siblings = [plan({ pauses_clock: false }), plan({ id: 'task-b', sort_order: 4 })]

    const body = await (await PATCH(request({ status: 'done' }), { params })).json()

    expect(body.shiftedDays).toBe(0)
    expect(body.shifted).toEqual([])
  })

  it('resuming charges the days parked and moves the task itself too', async () => {
    currentTask = task({ status: 'blocked', paused_at: '2026-03-10T12:00:00Z' })
    siblings = [
      plan({ id: 'task-a', sort_order: 3, status: 'in_progress', due_date: '2026-03-08' }),
      plan({ id: 'task-b', sort_order: 4, due_date: '2026-03-11', nudge_date: null }),
    ]

    const body = await (await PATCH(request({ paused: false }), { params })).json()

    // Paused 2026-03-10, resumed 2026-03-14 → four days.
    expect(body.shiftedDays).toBe(4)
    expect(updates[0].patch).toMatchObject({
      paused_at: null,
      status: 'in_progress',
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
    siblings = [
      plan({ status: 'blocked', paused_at: '2026-03-10T12:00:00Z' }),
      plan({ id: 'task-b', sort_order: 4, due_date: '2026-03-11' }),
    ]

    const body = await (
      await PATCH(request({ paused: false, status: 'done' }), { params })
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

/**
 * A task finished on the plan board is finished the same way as one ticked off
 * in the queue: the queue's PATCH records who did it and closes the subtasks
 * out, and a plan completion that did neither read back as unfinished work
 * everywhere else it appeared.
 */
describe('completing on the plan board', () => {
  it('records who finished it and closes out its subtasks', async () => {
    currentTask = task()
    currentTask.checklist = [{ text: 'Send the letter', done: false }, { text: 'File it', done: true }]

    await PATCH(request({ status: 'done' }), { params })

    expect(updates[0].patch).toMatchObject({
      status: 'done',
      completed_at: expect.any(String),
      completed_by: 'attorney-1',
      checklist: [{ text: 'Send the letter', done: true }, { text: 'File it', done: true }],
    })
  })

  it('keeps the original completion when an already-finished task is saved again', async () => {
    currentTask = task({ status: 'done' })
    currentTask.completed_at = '2026-03-09T10:00:00.000Z'
    currentTask.completed_by = 'paralegal-2'

    await PATCH(request({ status: 'done' }), { params })

    expect(updates[0].patch).toMatchObject({
      completed_at: '2026-03-09T10:00:00.000Z',
      completed_by: 'paralegal-2',
    })
  })

  it('clears the completion — and leaves the checklist alone — on any other status', async () => {
    currentTask = task({ status: 'done' })
    currentTask.checklist = [{ text: 'Send the letter', done: true }]

    await PATCH(request({ status: 'open' }), { params })

    expect(updates[0].patch).toMatchObject({ status: 'open', completed_at: null, completed_by: null })
    expect(updates[0].patch).not.toHaveProperty('checklist')
  })

  it('leaves no closeout marker behind for a later reopen to act on', async () => {
    currentTask = task()
    currentTask.closeout_reason = 'matter_closed'

    await PATCH(request({ status: 'done' }), { params })

    expect(updates[0].patch.closeout_reason).toBeNull()
  })
})
