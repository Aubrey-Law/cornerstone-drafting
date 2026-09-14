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
    expect(note).toContain('accept')
    expect(note).toContain('name and email are required')
    expect(note).toContain('never invent')
    expect(createLeadToolExecutor.tool.name).toBe(CREATE_LEAD_TOOL_NAME)
  })

  // A lead is a write, and client-authored text reaches the system prompt. The
  // tool therefore proposes; the attorney's Accept is what creates the record.
  it('proposes a lead instead of creating one', async () => {
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

    expect(createLead).not.toHaveBeenCalled()
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      proposed: true,
      requires_acceptance: true,
      changes: [{
        kind: 'create_lead',
        payload: {
          client_name: 'Jane Doe',
          client_email: 'jane@example.com',
          client_phone: '617-555-0100',
          practice_area: 'EP',
          fee_quoted: 3500,
        },
      }],
    })
    expect(events).toContainEqual(expect.objectContaining({
      tool: CREATE_LEAD_TOOL_NAME,
      status: 'done',
      result: expect.objectContaining({ proposal: expect.any(Array) }),
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
