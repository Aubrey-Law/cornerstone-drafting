import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no db in this test') }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))

import { calendarPlanningSystemPromptNote, calendarPlanningToolExecutors } from '@/lib/adminChat/calendarTools'
import { FIND_MATTER_TOOL_NAME } from '@/lib/adminChat/matterKnowledgeTools'

// Two tools searched the same records under different names and with
// different result shapes; the model called both in one turn. The record
// lookup lives in the matter-knowledge tools now, and the calendar tools
// point at it.
describe('the calendar tools do not carry their own record search', () => {
  it('no longer registers find_matter_or_lead', () => {
    const names = calendarPlanningToolExecutors().map(executor => executor.tool.name)
    expect(names).not.toContain('find_matter_or_lead')
  })

  it('tells the model to resolve ids with find_matter', () => {
    const note = calendarPlanningSystemPromptNote()
    expect(note).toContain(FIND_MATTER_TOOL_NAME)
    expect(note).not.toContain('find_matter_or_lead')
  })
})
