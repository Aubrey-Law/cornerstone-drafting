import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no db in this test') }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))

import { adminChatToolset } from '@/lib/adminChat/toolset'

const user = { id: 'user-1', email: 'a@b.c' }

function names(options: Parameters<typeof adminChatToolset>[0]) {
  return adminChatToolset(options).tools.map(executor => executor.tool.name)
}

/**
 * The two chat routes each hand-assembled their own tool list and drifted:
 * the Assistant page never registered read_design_sheet_status even though
 * its matter prompt told the model to call it. One factory, both surfaces.
 */
describe('one tool list serves both chat surfaces', () => {
  it('gives a matter chat the design-sheet status and import tools', () => {
    const tools = names({ contextType: 'matter', contextId: 'm1', user, surface: 'assistant' })
    expect(tools).toContain('read_design_sheet_status')
    expect(tools).toContain('propose_design_sheet_updates')
  })

  it('keeps the design-sheet tools out of a general chat', () => {
    const tools = names({ contextType: 'general', contextId: null, user, surface: 'assistant' })
    expect(tools).not.toContain('read_design_sheet_status')
    expect(tools).not.toContain('propose_design_sheet_updates')
  })

  it('registers the record, export, lead, workflow and calendar tools on every surface', () => {
    for (const surface of ['assistant', 'rail'] as const) {
      const tools = names({ contextType: 'general', contextId: null, user, surface })
      for (const expected of ['find_matter', 'read_matter_record', 'read_document_text', 'export_leads', 'export_matters', 'create_lead', 'read_workflow', 'create_task']) {
        expect(tools, surface).toContain(expected)
      }
    }
  })

  it('registers each tool name once', () => {
    const tools = names({ contextType: 'matter', contextId: 'm1', user, surface: 'assistant' })
    expect(new Set(tools).size).toBe(tools.length)
  })

  it('reserves the template builder for the Assistant page, where uploads arrive', () => {
    expect(names({ contextType: 'general', contextId: null, user, surface: 'assistant' })).toContain('analyze_template_upload')
    expect(names({ contextType: 'general', contextId: null, user, surface: 'rail' })).not.toContain('analyze_template_upload')
  })

  it('describes every registered tool family in the prompt notes', () => {
    const { promptNotes } = adminChatToolset({ contextType: 'matter', contextId: 'm1', user, surface: 'assistant' })
    for (const expected of ['WORKFLOWS', 'LEAD CREATION', 'LEAD EXPORT', 'MATTER EXPORT', 'CALENDAR PLANNING', 'TEMPLATE BUILDER', 'FIRM RECORD ACCESS']) {
      expect(promptNotes).toContain(expected)
    }
  })

  it('is what both routes build their tools from', async () => {
    const { readFileSync } = await import('node:fs')
    for (const route of ['app/api/admin/chat/route.ts', 'app/api/admin/assistant/chats/[chatId]/messages/route.ts']) {
      expect(readFileSync(route, 'utf8'), route).toContain('adminChatToolset(')
    }
  })
})
