import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createLead } = vi.hoisted(() => ({ createLead: vi.fn() }))
vi.mock('@/lib/leads/createLead', () => ({ createLead }))

import {
  CREATE_LEAD_TOOL_NAME,
  createLeadToolExecutor,
  leadSystemPromptNote,
} from '@/lib/adminChat/leadTools'

describe('assistant lead creation tool', () => {
  beforeEach(() => createLead.mockReset())

  it('requires an explicit request and required facts in its instructions', () => {
    const note = leadSystemPromptNote()
    expect(note).toContain('explicitly asks')
    expect(note).toContain('name and email are required')
    expect(note).toContain('never invent')
    expect(createLeadToolExecutor.tool.name).toBe(CREATE_LEAD_TOOL_NAME)
  })

  it('creates a lead through the shared lead service and returns its admin URL', async () => {
    createLead.mockResolvedValue({
      leadId: 'lead-1',
      clientName: 'Jane Doe',
      clientEmail: 'jane@example.com',
      practiceArea: 'EP',
    })
    const events: Record<string, unknown>[] = []
    const result = await createLeadToolExecutor.execute(
      {
        client_name: ' Jane Doe ',
        client_email: 'jane@example.com',
        client_phone: '617-555-0100',
        fee_quoted: 3500,
      },
      { toolUseId: 'tool-1', emit: event => events.push(event) },
    )

    expect(createLead).toHaveBeenCalledWith({
      clientName: 'Jane Doe',
      clientEmail: 'jane@example.com',
      clientPhone: '617-555-0100',
      practiceArea: 'EP',
      feeQuoted: 3500,
    })
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      lead_id: 'lead-1',
      url: '/admin/crm/opportunities/lead-1',
    })
    expect(events).toContainEqual(expect.objectContaining({
      tool: CREATE_LEAD_TOOL_NAME,
      status: 'done',
    }))
  })

  it('does not execute when required client facts are missing', async () => {
    const result = await createLeadToolExecutor.execute(
      { client_name: 'Jane Doe' },
      { toolUseId: 'tool-2', emit: vi.fn() },
    )
    expect(result.isError).toBe(true)
    expect(createLead).not.toHaveBeenCalled()
  })
})
