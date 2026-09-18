import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no db in this test') }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))

const today = vi.hoisted(() => ({
  fetchTodayData: vi.fn(),
}))
vi.mock('@/lib/queries/today', () => today)

import { adminChatToolset } from '@/lib/adminChat/toolset'
import { READ_FIRM_TODAY_TOOL_NAME, firmTodaySystemPromptNote, firmTodayToolExecutor } from '@/lib/adminChat/firmTodayTool'

/**
 * "Plan my day" answered from the calendar and due tasks alone, while the
 * Today page showed at-risk matters, unread client messages and the intake
 * queue. This tool hands the assistant the same facts the page is built from.
 */
function fixture() {
  return {
    atRisk: [
      {
        entity: 'matter', id: 'm1', client_name: 'Amy Chen', current_stage: 'design_review', owner: 'attorney',
        days_in_stage: 12, days_over_sla: 5, health: 'red', is_snoozed: false, track: 'trust',
      },
      {
        entity: 'lead', id: 'l1', client_name: 'Bob Lee', current_stage: 'intake_sent', owner: 'client',
        days_in_stage: 9, days_over_sla: null, health: 'amber', is_snoozed: false, track: 'lead',
      },
    ],
    waitingOnYou: [], waitingOnClient: [], snoozed: [],
    unreadThreads: [{ matter_id: 'm1', client_name: 'Amy Chen', unread_count: 2, latest_at: '2026-09-17T14:00:00Z' }],
    intakeReview: [{ matter_id: 'm2', client_name: 'Cara Diaz', matter_name: 'Diaz Estate Plan', stage: 'intake_submitted' }],
    intakeToSend: [],
    appointmentsToday: [{ id: 'a1', matter_id: 'm1', client_name: 'Amy Chen', next_appointment: '2026-09-18T15:00:00Z', next_appointment_type: 'design_meeting', href: '/admin/matters/m1', is_all_day: false }],
    overdueTasks: [{ id: 't1', title: 'Call Amy about trustee', due_at: '2026-09-15T12:00:00Z', matter_id: 'm1', lead_id: null, status: 'open', priority: 'high' }],
    tasksDueToday: [],
    activeMatterCount: 31,
    needsYou: 1,
    overdueCount: 1,
    overdueMatterCount: 1,
    overdueLeadCount: 0,
    billing: { unbilledCount: 2, unbilledCents: 120000, overdueInvoices: [{ id: 'i1', number: 'INV-7', matterId: 'm1', clientName: 'Amy Chen', balanceCents: 250000, daysPastDue: 12 }], overdueCents: 250000 },
  }
}

const ctx = () => {
  const events: Record<string, unknown>[] = []
  return { events, hooks: { toolUseId: 'tool-1', emit: (event: Record<string, unknown>) => events.push(event) } }
}

beforeEach(() => {
  today.fetchTodayData.mockReset()
  today.fetchTodayData.mockResolvedValue(fixture())
})

describe('the firm-today tool', () => {
  it('reads the same facts the Today page is built from, with links', async () => {
    const { hooks, events } = ctx()
    const result = await firmTodayToolExecutor.execute({}, hooks)
    const body = JSON.parse(result.content) as Record<string, unknown>

    expect(today.fetchTodayData).toHaveBeenCalledWith({ includeCalendar: false })
    expect(body.ok).toBe(true)
    expect(body.active_matter_count).toBe(31)
    const atRisk = body.at_risk as Array<Record<string, unknown>>
    expect(atRisk[0]).toMatchObject({ client_name: 'Amy Chen', type: 'matter', ball_in: 'attorney', days_over_sla: 5, url: '/admin/matters/m1' })
    expect(atRisk[1]).toMatchObject({ type: 'lead', url: '/admin/crm/opportunities/l1' })
    expect((body.unread_client_messages as unknown[]).length).toBe(1)
    expect((body.intakes_to_review as Array<Record<string, unknown>>)[0]).toMatchObject({ client_name: 'Cara Diaz', url: '/admin/drafting/m2' })
    expect((body.overdue_tasks as Array<Record<string, unknown>>)[0]).toMatchObject({ title: 'Call Amy about trustee', matter_id: 'm1' })
    expect(body.billing).toMatchObject({ overdue_invoice_count: 1, overdue_dollars: 2500, unbilled_dollars: 1200 })
    expect(events.at(-1)).toMatchObject({ tool: READ_FIRM_TODAY_TOOL_NAME, status: 'done', result: { at_risk_count: 2, unread_count: 1, overdue_task_count: 1 } })
  })

  it('reports a failed read as a tool error, not an empty day', async () => {
    today.fetchTodayData.mockRejectedValueOnce(new Error('pipeline view unavailable'))
    const { hooks } = ctx()
    const result = await firmTodayToolExecutor.execute({}, hooks)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('pipeline view unavailable')
  })

  it('tells the model to use it for planning prompts', () => {
    const note = firmTodaySystemPromptNote()
    expect(note).toContain(READ_FIRM_TODAY_TOOL_NAME)
    expect(note.toLowerCase()).toContain('plan my day')
  })

  it('is registered on both chat surfaces', () => {
    for (const surface of ['assistant', 'rail'] as const) {
      const names = adminChatToolset({ contextType: 'general', contextId: null, user: { id: 'u1', email: null }, surface }).tools.map(t => t.tool.name)
      expect(names, surface).toContain(READ_FIRM_TODAY_TOOL_NAME)
    }
    expect(adminChatToolset({ contextType: 'general', contextId: null, user: { id: 'u1', email: null }, surface: 'rail' }).promptNotes).toContain('FIRM TODAY')
  })
})
