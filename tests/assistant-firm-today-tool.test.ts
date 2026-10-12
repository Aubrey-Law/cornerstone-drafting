import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no db in this test') }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))
vi.mock('@/lib/appointments/calendarBusy', () => ({ fetchCalendarBusy: vi.fn(async () => []) }))

const today = vi.hoisted(() => ({
  fetchTodayData: vi.fn(),
  // The work graph imports `emptyTodayData` from this module at load time.
  // Provide a benign default so vitest's vi.mock resolves cleanly.
  emptyTodayData: () => ({
    atRisk: [], waitingOnYou: [], waitingOnClient: [], snoozed: [],
    unreadThreads: [], intakeReview: [], intakeToSend: [], appointmentsToday: [],
    overdueTasks: [], tasksDueToday: [], activeMatterCount: 0, needsYou: 0,
    overdueCount: 0, overdueMatterCount: 0, overdueLeadCount: 0,
    billing: { unbilledCount: 0, unbilledCents: 0, overdueInvoices: [] },
  }),
}))
vi.mock('@/lib/queries/today', () => today)

const plans = vi.hoisted(() => ({
  fetchDailyPlan: vi.fn(),
}))
vi.mock('@/lib/work/plans', () => plans)

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
  plans.fetchDailyPlan.mockReset()
  plans.fetchDailyPlan.mockResolvedValue(null)
})

describe('the firm-today tool', () => {
  it('reads the same canonical ranked plan as the command center, with links', async () => {
    const data = fixture()
    data.waitingOnYou = [{
      ...data.atRisk[0],
      action: { kind: 'draft', label: 'Draft', href: '/admin/matters/m1' },
      nudge_matter_id: null,
    } as never]
    data.waitingOnClient = [{
      ...data.atRisk[1], action: null, nudge_matter_id: null,
    } as never]
    today.fetchTodayData.mockResolvedValueOnce(data)
    const { hooks, events } = ctx()
    const result = await firmTodayToolExecutor.execute({}, hooks)
    const body = JSON.parse(result.content) as Record<string, unknown>

    expect(today.fetchTodayData).toHaveBeenCalledWith(expect.objectContaining({
      includeCalendar: expect.any(Boolean),
      dueTasks: expect.any(Promise),
    }))
    expect(body.ok).toBe(true)
    // Stuck drafting (red, ≥3 days over SLA) is Critical, so it leads the plan
    // ahead of ordinary client-message Must-do work.
    expect(body.now).toMatchObject({
      source: 'matter_action',
      title: 'Draft',
      record: { type: 'matter', id: 'm1' },
    })
    const mustDo = body.must_do as Array<Record<string, unknown>>
    expect(mustDo.some(item => item.source === 'portal_message' && item.title === 'Reply to Amy Chen')).toBe(true)
    expect((body.waiting_or_blocked as Array<Record<string, unknown>>).some(item => item.owner === 'client')).toBe(true)
    expect(events.at(-1)).toMatchObject({ tool: READ_FIRM_TODAY_TOOL_NAME, status: 'done', result: { overload: expect.any(Boolean) } })
  })

  it('reports a failed today read as a source error, not a crashed tool', async () => {
    today.fetchTodayData.mockRejectedValueOnce(new Error('pipeline view unavailable'))
    const { hooks } = ctx()
    const result = await firmTodayToolExecutor.execute({}, hooks)

    expect(result.isError).toBeUndefined()
    const body = JSON.parse(result.content) as { ok: boolean; source_errors: string[] }
    expect(body.ok).toBe(true)
    expect(body.source_errors).toContain('today')
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
