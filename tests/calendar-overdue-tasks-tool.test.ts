import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no db in this test') }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))
const queries = vi.hoisted(() => ({
  fetchDueTasks: vi.fn(),
  fetchTasks: vi.fn(async () => []),
}))
vi.mock('@/lib/queries/tasks', () => queries)

import { calendarPlanningToolExecutors } from '@/lib/adminChat/calendarTools'

const LONG_AGO = '2026-01-05T15:00:00Z'
const FAR_AHEAD = '2030-01-05T15:00:00Z'

function task(overrides: Record<string, unknown>) {
  return {
    id: 't', title: 'Task', description: null, status: 'open', priority: 'normal', source: 'manual', task_type: 'general',
    checklist: [], matter_id: 'm1', lead_id: null, stage_key: null, stage_entered_at: null, batch_tag: null,
    soft_due_at: null, hard_due_at: null, due_at: LONG_AGO, assignee_id: null, estimate_minutes: null, remind_at: null,
    recurrence: null, template_id: null, document_id: null, completed_at: null, completed_by: null, created_by: null,
    created_at: LONG_AGO, updated_at: LONG_AGO, owner: 'firm', record_name: 'Chen Family Trust',
    ...overrides,
  }
}

const overdueTool = () => calendarPlanningToolExecutors().find(executor => executor.tool.name === 'list_overdue_followups')!
const ctx = () => {
  const events: Record<string, unknown>[] = []
  return { events, hooks: { toolUseId: 'tool-1', emit: (event: Record<string, unknown>) => events.push(event) } }
}

beforeEach(() => {
  queries.fetchDueTasks.mockReset()
  queries.fetchDueTasks.mockResolvedValue([
    task({ id: 'a', title: 'Follow up with Amy on trustee', priority: 'high' }),
    task({ id: 'b', title: 'Review trust draft markers', task_type: 'drafting' }),
    task({ id: 'c', title: 'Email Bob the engagement letter', matter_id: null, lead_id: 'l1', record_name: 'Bob Lee' }),
    task({ id: 'd', title: 'Call about signing', due_at: FAR_AHEAD }),
  ])
})

/**
 * The tool answered "what is overdue?" from the tasks whose titles happened
 * to contain follow-up words. A "Review trust draft markers" task three weeks
 * late was invisible to the assistant.
 */
describe('the overdue tasks tool', () => {
  it('returns every overdue task, not only the ones with follow-up in the title', async () => {
    const { hooks, events } = ctx()
    const result = await overdueTool().execute({}, hooks)
    const body = JSON.parse(result.content) as { ok: boolean; total: number; tasks: Array<Record<string, unknown>> }

    expect(body.ok).toBe(true)
    expect(body.total).toBe(3)
    expect(body.tasks.map(row => row.title)).toEqual([
      'Follow up with Amy on trustee', 'Review trust draft markers', 'Email Bob the engagement letter',
    ])
    expect(body.tasks[0]).toMatchObject({ record_name: 'Chen Family Trust', matter_id: 'm1', priority: 'high', url: '/admin/matters/m1?tab=tasks' })
    expect(body.tasks[2]).toMatchObject({ lead_id: 'l1', url: '/admin/crm/opportunities/l1' })
    expect(typeof body.tasks[0]!.days_overdue).toBe('number')
    expect(events.at(-1)).toMatchObject({ tool: 'list_overdue_followups', status: 'done', result: { count: 3 } })
  })

  it('narrows to follow-up style tasks only when asked', async () => {
    const result = await overdueTool().execute({ only_followups: true }, ctx().hooks)
    const body = JSON.parse(result.content) as { tasks: Array<{ title: string }> }
    expect(body.tasks.map(row => row.title)).toEqual(['Follow up with Amy on trustee', 'Email Bob the engagement letter'])
  })

  it('caps the rows and says how many there were', async () => {
    const result = await overdueTool().execute({ limit: 2 }, ctx().hooks)
    const body = JSON.parse(result.content) as { total: number; truncated: boolean; tasks: unknown[] }
    expect(body.tasks).toHaveLength(2)
    expect(body.total).toBe(3)
    expect(body.truncated).toBe(true)
  })

  it('describes itself as every overdue task, with an optional follow-up filter', () => {
    const { tool } = overdueTool()
    expect((tool.description ?? '').toLowerCase()).toContain('every overdue')
    expect(JSON.stringify(tool.input_schema)).toContain('only_followups')
  })

  it('reports a failed read as a tool error rather than an empty list', async () => {
    queries.fetchDueTasks.mockRejectedValueOnce(new Error('Due tasks are unavailable. Please retry.'))
    const result = await overdueTool().execute({}, ctx().hooks)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('unavailable')
  })
})
