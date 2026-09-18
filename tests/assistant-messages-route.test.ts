import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c' } })),
  isAdministrator: vi.fn(async () => true),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 60, retryAfterSeconds: 0 })),
}))

type StreamOptions = {
  system: string
  messages: Array<{ role: string; content: unknown }>
  initialEvents?: Record<string, unknown>[]
}
const engine = vi.hoisted(() => ({
  createAdminChatStream: vi.fn((_options: StreamOptions) => new Response('ok')),
}))
vi.mock('@/lib/adminChat/engine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/adminChat/engine')>()),
  createAdminChatStream: engine.createAdminChatStream,
  buildContext: vi.fn(async () => ({ systemPrompt: 'GENERAL PROMPT', matterLabel: null })),
  generalSystemPrompt: vi.fn(async () => 'GENERAL PROMPT'),
}))

const chats = vi.hoisted(() => ({
  chat: { id: 'c1', user_id: 'user-1', title: null, context_type: 'general', context_id: null },
  history: [] as Array<{ role: string; content: string; events: unknown[] }>,
  appended: [] as Array<{ role: string; content: string; events?: unknown[] }>,
}))
vi.mock('@/lib/assistantChats', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/assistantChats')>()),
  getAssistantChat: vi.fn(async () => chats.chat),
  listAssistantChatMessages: vi.fn(async () => chats.history),
  appendAssistantChatMessage: vi.fn(async (_chatId: string, message: { role: string; content: string; events?: unknown[] }) => {
    chats.appended.push(message)
    return { id: 'm', ...message }
  }),
  setAssistantChatTitleIfEmpty: vi.fn(async () => undefined),
}))

const attachment = vi.hoisted(() => ({
  loadAttachedWorkflow: vi.fn(async () => ({
    id: 'wf',
    title: 'Matter Next Steps',
    body: 'DO THE STEPS',
    executionMode: 'chat',
    allowedContext: ['matter'],
  }) as unknown),
}))
vi.mock('@/lib/adminChat/workflowAttachment', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/adminChat/workflowAttachment')>()),
  loadAttachedWorkflow: attachment.loadAttachedWorkflow,
}))

import { POST } from '@/app/api/admin/assistant/chats/[chatId]/messages/route'

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/admin/assistant/chats/c1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ chatId: 'c1' }) },
  )
}

function lastStreamOptions(): StreamOptions {
  return engine.createAdminChatStream.mock.calls.at(-1)![0]
}

beforeEach(() => {
  vi.clearAllMocks()
  chats.history = []
  chats.appended = []
  chats.chat = { id: 'c1', user_id: 'user-1', title: null, context_type: 'general', context_id: null }
})

describe('an attached workflow is injected by the route, not fetched by the model', () => {
  it('puts the workflow body into the system prompt', async () => {
    await post({ content: 'Run it for the Chens', workflow: { id: 'wf', title: 'Matter Next Steps' } })

    expect(attachment.loadAttachedWorkflow).toHaveBeenCalledWith('wf', { userId: 'user-1', email: 'a@b.c' })
    expect(lastStreamOptions().system).toContain('DO THE STEPS')
  })

  it('marks the reply as following the workflow before the model speaks', async () => {
    await post({ content: 'go', workflow: { id: 'wf', title: 'Matter Next Steps' } })

    expect(lastStreamOptions().initialEvents).toEqual([
      { workflow_applied: { workflow_id: 'wf', title: 'Matter Next Steps' } },
    ])
  })

  it('tells a general chat to resolve the matter first for a matter-scoped workflow', async () => {
    await post({ content: 'go', workflow: { id: 'wf', title: 'Matter Next Steps' } })

    expect(lastStreamOptions().system).toContain('find_matter')
  })

  it('leaves the prompt alone when no workflow is attached', async () => {
    await post({ content: 'hello' })

    expect(attachment.loadAttachedWorkflow).not.toHaveBeenCalled()
    expect(lastStreamOptions().system).not.toContain('ATTACHED WORKFLOW —')
    expect(lastStreamOptions().initialEvents ?? []).toEqual([])
  })

  it('warns the attorney when the attached workflow cannot be loaded', async () => {
    attachment.loadAttachedWorkflow.mockResolvedValueOnce(null)

    await post({ content: 'go', workflow: { id: 'gone', title: 'Deleted' } })

    const options = lastStreamOptions() as StreamOptions & { preamble?: string }
    expect(options.preamble).toContain('Deleted')
    expect(options.system).not.toContain('ATTACHED WORKFLOW —')
  })
})

type PersistOptions = StreamOptions & {
  onToolRound?: (round: { assistantContent: unknown[]; toolResults: unknown[] }) => void
  onComplete?: (result: { text: string; success: boolean }) => Promise<void> | void
}

describe('what the model read is saved with the reply', () => {
  it('stores each tool round in the reply’s events and keeps the text as the content', async () => {
    await post({ content: 'What stage are the Chens at?' })
    const options = lastStreamOptions() as PersistOptions
    const toolUse = { type: 'tool_use', id: 't1', name: 'read_matter_record', input: {} }

    options.onToolRound?.({ assistantContent: [toolUse], toolResults: [{ type: 'tool_result', tool_use_id: 't1', content: '{"stage":"design"}' }] })
    await options.onComplete?.({ text: 'Design.', success: true })

    const saved = chats.appended.find(message => message.role === 'assistant')!
    expect(saved.content).toBe('Design.')
    expect(saved.events).toContainEqual({
      tool_round: { assistant_content: [toolUse], tool_results: [{ type: 'tool_result', tool_use_id: 't1', content: '{"stage":"design"}' }] },
    })
  })

  it('saves a tool-only reply with empty content rather than a placeholder sentence', async () => {
    await post({ content: 'find the chens' })
    const options = lastStreamOptions() as PersistOptions

    options.onToolRound?.({ assistantContent: [{ type: 'tool_use', id: 't1', name: 'find_matter', input: {} }], toolResults: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] })
    await options.onComplete?.({ text: '', success: true })

    const saved = chats.appended.find(message => message.role === 'assistant')!
    expect(saved.content).toBe('')
    expect((saved.events ?? []).some(event => 'tool_round' in (event as Record<string, unknown>))).toBe(true)
  })

  it('replays stored tool rounds to the model on the next turn', async () => {
    chats.history = [
      { role: 'user', content: 'earlier', events: [] },
      { role: 'assistant', content: 'Design.', events: [{ tool_round: { assistant_content: [{ type: 'tool_use', id: 't1', name: 'read_matter_record', input: {} }], tool_results: [{ type: 'tool_result', tool_use_id: 't1', content: '{"stage":"design"}' }] } }] },
    ]

    await post({ content: 'and the trustee?' })

    const sent = lastStreamOptions().messages
    expect(sent.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect((sent[2]!.content as Array<{ content: string }>)[0]!.content).toBe('{"stage":"design"}')
  })
})
