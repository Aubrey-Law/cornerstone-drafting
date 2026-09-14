import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no writes in this test') }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(() => { throw new Error('no calendar writes in this test') }),
}))

import { calendarPlanningToolExecutors, calendarPlanningSystemPromptNote } from '@/lib/adminChat/calendarTools'

/**
 * create_task inserted a task, an appointment and a real Google Calendar event
 * on the model's say-so alone, while client-authored notes were reaching the
 * same system prompt unfenced. It now proposes.
 */
describe('create_task is a proposal, not a write', () => {
  const executor = calendarPlanningToolExecutors({ defaultMatterId: 'matter-1' })
    .find(candidate => candidate.tool.name === 'create_task')

  it('is registered', () => {
    expect(executor).toBeDefined()
  })

  it('emits a proposal and writes nothing', async () => {
    const events: Record<string, unknown>[] = []
    const result = await executor!.execute(
      { title: 'Call the client', calendarAddToCalendar: true, calendarStartAt: '2026-10-01T14:00:00Z', calendarDurationMinutes: 30 },
      { toolUseId: 'tool-1', emit: event => events.push(event) },
    )

    const parsed = JSON.parse(result.content) as {
      ok: boolean
      proposed: boolean
      requires_acceptance: boolean
      changes: Array<{ kind: string; title: string; payload: Record<string, unknown> }>
    }
    expect(parsed).toMatchObject({ ok: true, proposed: true, requires_acceptance: true })
    expect(parsed.changes[0]!.kind).toBe('create_task')
    expect(parsed.changes[0]!.title).toBe('Call the client')
    expect(parsed.changes[0]!.payload).toMatchObject({ title: 'Call the client', matter_id: 'matter-1' })
    expect(events).toContainEqual(expect.objectContaining({
      tool: 'create_task',
      status: 'done',
      result: expect.objectContaining({ proposal: expect.any(Array) }),
    }))
  })

  it('refuses a task with no title rather than proposing an empty one', async () => {
    const result = await executor!.execute({}, { toolUseId: 'tool-2', emit: () => {} })
    expect(result.isError).toBe(true)
  })

  it('tells the assistant that task creation needs acceptance', () => {
    expect(calendarPlanningSystemPromptNote()).toContain('accept')
  })
})
