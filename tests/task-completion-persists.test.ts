import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChecklistItem, TaskRow } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

/**
 * Executed-handler tests for PATCH /api/admin/tasks/[id] — the one endpoint
 * every ordinary task surface completes through (the Tasks page, the rail, a
 * record's tasks tab, Today).
 *
 * They exist because of a bug report that a task ticked off came back as open
 * after the user left the page and returned. The Tasks page is
 * `force-dynamic` and re-reads on every visit, so a row that comes back is a
 * row that really is `open` in the database — which made this handler, and
 * what it writes alongside `status`, the place to look. Three writes were
 * wrong, and each has a case below.
 */

const TASK_ID = '33333333-3333-4333-8333-333333333333'
const VIEWER = 'attorney-1'

/** Every `update()` the handler issued, with the row it targeted. */
const updates: { id: string | null; patch: Record<string, unknown> }[] = []
let currentTask: TaskRow = taskFixture({ id: TASK_ID })

/**
 * Enough of the PostgREST builder to drive this route: filters chain and are
 * recorded, and `maybeSingle`/`single` resolve the row the handler reads back.
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
      const recorded = updates.find(entry => entry.patch === patch)
      if (recorded && !recorded.id) recorded.id = (filters.id as string) ?? null
      return { data: { ...currentTask, ...(patch ?? {}) }, error: null }
    },
  }

  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => builder() }),
  ADMIN_EMAIL: 'admin@example.invalid',
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: async () => ({ err: null, userId: VIEWER, user: { id: VIEWER, email: null } }),
}))

vi.mock('@/lib/tasks/server', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tasks/server')>()
  return { ...actual, logTaskActivity: async () => {}, createNextOccurrence: async () => null }
})

type PatchHandler = typeof import('@/app/api/admin/tasks/[id]/route')['PATCH']

let PATCH: PatchHandler

beforeAll(async () => {
  ;({ PATCH } = await import('@/app/api/admin/tasks/[id]/route'))
})

function request(body: unknown) {
  return new Request(`http://localhost/api/admin/tasks/${TASK_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: TASK_ID })

async function patchTask(body: unknown) {
  const res = await PATCH(request(body), { params })
  return { status: res.status, written: updates[0]?.patch ?? {} }
}

function subtasks(...done: boolean[]): ChecklistItem[] {
  return done.map((isDone, index) => ({ text: `Step ${index + 1}`, done: isDone }))
}

beforeEach(() => {
  updates.length = 0
  currentTask = taskFixture({ id: TASK_ID })
})

describe('completing a task', () => {
  it('stamps who finished it and when', async () => {
    const { written } = await patchTask({ status: 'done' })

    expect(written.status).toBe('done')
    expect(written.completed_at).toEqual(expect.any(String))
    expect(written.completed_by).toBe(VIEWER)
  })

  it('stamps the completion when the last subtask is what finishes it', async () => {
    currentTask = taskFixture({ id: TASK_ID, task_type: 'checklist', checklist: subtasks(true, false) })

    const { written } = await patchTask({ checklist_index: 1, done: true })

    expect(written.status).toBe('done')
    // Done today is read off `completed_at`. Without the stamp the task left
    // the queue and appeared in no completed list at all.
    expect(written.completed_at).toEqual(expect.any(String))
    expect(written.completed_by).toBe(VIEWER)
  })

  it('clears the closeout marker so a later reopen cannot revive it', async () => {
    currentTask = taskFixture({ id: TASK_ID, status: 'archived', skipped_at: '2026-09-01T00:00:00Z', closeout_reason: 'not_engaged' })

    const { written } = await patchTask({ status: 'done' })

    // `restoreTasksForReopenedRecord` puts back every row still carrying a
    // reason; leaving one on a task the user just finished is how a completed
    // task comes back as open when its record is reopened.
    expect(written.closeout_reason).toBeNull()
    expect(written.skipped_at).toBeNull()
  })

  it('closes out the subtasks that are still open', async () => {
    currentTask = taskFixture({ id: TASK_ID, task_type: 'checklist', checklist: subtasks(true, false) })

    const { written } = await patchTask({ status: 'done' })

    expect(written.checklist).toEqual([
      { text: 'Step 1', done: true },
      { text: 'Step 2', done: true },
    ])
  })
})

describe('editing a task that is already finished', () => {
  const done = () =>
    taskFixture({
      id: TASK_ID,
      status: 'done',
      completed_at: '2026-09-10T14:00:00Z',
      completed_by: VIEWER,
    })

  /** What the detail sheet sends: every field it edits, status and checklist among them. */
  function sheetSave(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Call the client',
      description: 'Ask about the deed',
      status: 'done',
      priority: 'normal',
      due_at: null,
      assignee_id: null,
      estimate_minutes: null,
      recurrence: null,
      checklist: [],
      ...overrides,
    }
  }

  it('leaves it finished when the sheet saves an edit', async () => {
    currentTask = done()

    const { written } = await patchTask(sheetSave())

    // A task with no subtasks used to read as "not all done" here, which
    // silently reopened it — and the sheet sends a checklist on every save.
    expect(written.status).toBe('done')
    expect(written.description).toBe('Ask about the deed')
  })

  it('keeps the completion it already recorded instead of re-dating it', async () => {
    currentTask = done()

    const { written } = await patchTask(sheetSave({ title: 'Call the client back' }))

    // Re-stamping would move the task out of the day it was actually finished
    // on, which is the day "Done today" reads.
    expect(written.completed_at).toBe('2026-09-10T14:00:00Z')
    expect(written.completed_by).toBe(VIEWER)
  })

  it('takes the status the request asked for over the one its subtasks imply', async () => {
    currentTask = done()

    const { written } = await patchTask(sheetSave({ checklist: subtasks(true, false) }))

    expect(written.status).toBe('done')
    expect(written.checklist).toEqual([
      { text: 'Step 1', done: true },
      { text: 'Step 2', done: true },
    ])
  })

  it('reopens it when that is what the request asked for', async () => {
    currentTask = done()

    const { written } = await patchTask(sheetSave({ status: 'open', checklist: subtasks(true, true) }))

    expect(written.status).toBe('open')
    expect(written.completed_at).toBeNull()
    expect(written.completed_by).toBeNull()
  })

  it('reopens it when a subtask is unticked, because nothing else said otherwise', async () => {
    currentTask = taskFixture({
      id: TASK_ID,
      status: 'done',
      task_type: 'checklist',
      checklist: subtasks(true, true),
      completed_at: '2026-09-10T14:00:00Z',
      completed_by: VIEWER,
    })

    const { written } = await patchTask({ checklist_index: 0, done: false })

    expect(written.status).toBe('open')
    expect(written.completed_at).toBeNull()
  })
})
