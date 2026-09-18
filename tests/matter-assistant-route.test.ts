import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c' } })),
  isAdministrator: vi.fn(async () => true),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 60, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))

/** matter_documents lookup for the attached drafts; anything else throws. */
const db = vi.hoisted(() => ({
  documents: [{ id: 'd1', name: 'Chen Revocable Trust.docx' }, { id: 'd2', name: 'Pour-over Will.docx' }],
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'matter_documents') throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: async (_column: string, ids: string[]) => ({ data: db.documents.filter(doc => ids.includes(doc.id)), error: null }),
      }
      return chain
    },
  })),
}))

type StreamOptions = {
  system: string
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{ tool: { name: string } }>
  usage: { route: string }
  onComplete?: (result: { text: string; success: boolean; aborted?: boolean }) => Promise<void> | void
}
const engine = vi.hoisted(() => ({
  createAdminChatStream: vi.fn((_options: StreamOptions) => new Response('ok')),
  loadMatterContext: vi.fn(async () => ({ systemPrompt: 'MATTER PROMPT FOR THE CHENS', matterLabel: 'Chen · #00-000' })),
}))
vi.mock('@/lib/adminChat/engine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/adminChat/engine')>()),
  createAdminChatStream: engine.createAdminChatStream,
  loadMatterContext: engine.loadMatterContext,
}))

const history = vi.hoisted(() => ({
  turns: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  appended: [] as Array<Array<{ role: string; content: string }>>,
}))
vi.mock('@/lib/matterAssistantHistory', () => ({
  listMatterAssistantHistory: vi.fn(async () => history.turns),
  appendMatterAssistantTurns: vi.fn(async (_admin: unknown, _matterId: string, _userId: string, turns: Array<{ role: string; content: string }>) => {
    history.appended.push(turns)
  }),
  clearMatterAssistantHistory: vi.fn(async () => undefined),
}))

const mcp = vi.hoisted(() => ({
  loadMcpToolsForUser: vi.fn(async () => ({
    tools: [{ name: 'mcp_abc_lookup', description: '[Clio] lookup', inputSchema: { type: 'object', properties: {} } }],
    registry: [{ llmName: 'mcp_abc_lookup', connectorName: 'Clio', mcpToolName: 'lookup' }],
  })),
  executeMcpToolCall: vi.fn(async () => ({ ok: true, text: '{"found":true}', connectorName: 'Clio', mcpToolName: 'lookup' })),
}))
vi.mock('@/lib/matterAssistantTools', () => mcp)

import { POST } from '@/app/api/admin/matters/[id]/assistant/route'

function post(body: unknown, matterId = 'm1') {
  return POST(
    new Request(`http://localhost/api/admin/matters/${matterId}/assistant`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: matterId }) },
  )
}
const lastOptions = () => engine.createAdminChatStream.mock.calls.at(-1)![0]

beforeEach(() => {
  vi.clearAllMocks()
  history.turns = []
  history.appended = []
})

/**
 * The Review step's panel ran its own chat lane: a user-preference LLM, five
 * design-sheet fields and document names for context, and no firm-record
 * tools. It now runs the shared engine, so it sees the same matter and can
 * do the same things as the Assistant page and the rail.
 */
describe('the Review-step assistant runs the shared engine', () => {
  it('streams with the full matter prompt and the shared tool set', async () => {
    await post({ message: 'Is the successor trustee consistent across drafts?' })

    expect(engine.loadMatterContext).toHaveBeenCalledWith('m1')
    const options = lastOptions()
    expect(options.system).toContain('MATTER PROMPT FOR THE CHENS')
    expect(options.system).toContain('FIRM RECORD ACCESS')
    const names = (options.tools ?? []).map(executor => executor.tool.name)
    for (const expected of ['read_matter_record', 'read_document_text', 'read_design_sheet_status', 'propose_design_sheet_updates', 'create_task']) {
      expect(names).toContain(expected)
    }
    expect(options.usage.route).toBe('matters/assistant')
  })

  it('names the attached drafts and tells the model how to read them', async () => {
    await post({ message: 'Compare these', documentIds: ['d1', 'd2'] })

    const system = lastOptions().system
    expect(system).toContain('REVIEW STEP')
    expect(system).toContain('Chen Revocable Trust.docx')
    expect(system).toContain('d2')
    expect(system).toContain('read_document_text')
  })

  it('keeps staff MCP connector tools available, as tools the shared loop can call', async () => {
    await post({ message: 'look it up' })

    const options = lastOptions()
    const executor = (options.tools ?? []).find(candidate => candidate.tool.name === 'mcp_abc_lookup') as
      | { execute: (input: unknown, ctx: { toolUseId: string; emit: (e: Record<string, unknown>) => void }) => Promise<{ content: string }> }
      | undefined
    expect(executor).toBeTruthy()
    const result = await executor!.execute({}, { toolUseId: 't1', emit: () => {} })
    expect(mcp.executeMcpToolCall).toHaveBeenCalled()
    expect(result.content).toContain('"found":true')
  })

  it('replays the shared per-matter thread and persists both turns when the reply lands', async () => {
    history.turns = [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier answer' }]
    await post({ message: 'and now?' })

    const options = lastOptions()
    expect(options.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    await options.onComplete?.({ text: 'Here you go.', success: true })

    expect(history.appended).toEqual([[{ role: 'user', content: 'and now?' }, { role: 'assistant', content: 'Here you go.' }]])
  })

  it('persists nothing for a failed send, as before', async () => {
    await post({ message: 'q' })
    await lastOptions().onComplete?.({ text: '', success: false })
    expect(history.appended).toEqual([])
  })

  it('answers 404 for a matter that does not exist', async () => {
    engine.loadMatterContext.mockRejectedValueOnce(new Error('Matter not found'))
    const response = await post({ message: 'q' }, 'nope')
    expect(response.status).toBe(404)
  })

  it('still requires a message', async () => {
    expect((await post({})).status).toBe(400)
  })
})
