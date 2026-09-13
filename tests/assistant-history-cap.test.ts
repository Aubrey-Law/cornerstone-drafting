import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

type StreamOptions = { messages: Array<{ role: string; content: string }> }
const engine = vi.hoisted(() => ({
  createAdminChatStream: vi.fn((_options: { messages: Array<{ role: string; content: string }> }) => new Response('ok')),
}))
vi.mock('@/lib/adminChat/engine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/adminChat/engine')>()),
  createAdminChatStream: engine.createAdminChatStream,
  loadMatterContext: vi.fn(async () => ({ systemPrompt: 'matter', matterLabel: 'Smith' })),
  loadLeadContext: vi.fn(async () => ({ systemPrompt: 'lead', matterLabel: 'Smith' })),
  generalSystemPrompt: vi.fn(async () => 'general'),
}))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c' } })),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 60, retryAfterSeconds: 0 })),
}))

import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  ASSISTANT_MODEL_HISTORY_TURNS,
  listAssistantChatMessages,
} from '@/lib/assistantChats'
import { POST as chatPost } from '@/app/api/admin/chat/route'

/** Records the limit the query asked for and replays rows newest-first, as PostgREST would. */
function stubMessagesClient(rows: Array<{ content: string }>, seen: { limit?: number }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order']) chain[method] = () => chain
  chain.limit = (value: number) => {
    seen.limit = value
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: [...rows].reverse().slice(0, value), error: null }).then(onFulfilled)
    return chain
  }
  chain.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ data: [...rows].reverse(), error: null }).then(onFulfilled)
  return { from: () => chain }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assistant chat history is bounded', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: `m${i}`, chat_id: 'c1', role: 'user', content: `turn ${i}`, events: [], created_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
  }))

  it('replays only the newest turns, in chronological order', async () => {
    const seen: { limit?: number } = {}
    vi.mocked(getAdminClient).mockReturnValue(stubMessagesClient(rows, seen) as never)

    const messages = await listAssistantChatMessages('c1')

    expect(seen.limit).toBe(ASSISTANT_MODEL_HISTORY_TURNS)
    expect(messages).toHaveLength(ASSISTANT_MODEL_HISTORY_TURNS)
    expect(messages[0].content).toBe('turn 60')
    expect(messages[messages.length - 1].content).toBe('turn 99')
  })

  it('lets a caller ask for a wider window for display', async () => {
    const seen: { limit?: number } = {}
    vi.mocked(getAdminClient).mockReturnValue(stubMessagesClient(rows, seen) as never)

    await listAssistantChatMessages('c1', { limit: 200 })

    expect(seen.limit).toBe(200)
  })
})

describe('the rail chat does not trust the client to bound its own history', () => {
  it('sends only the newest turns to the model', async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }))
    await chatPost(new Request('http://localhost/api/admin/chat', {
      method: 'POST',
      body: JSON.stringify({ context_type: 'general', messages }),
    }))

    const sent = (engine.createAdminChatStream.mock.calls[0]![0] as StreamOptions).messages
    expect(sent.length).toBeLessThanOrEqual(ASSISTANT_MODEL_HISTORY_TURNS)
    expect(sent[sent.length - 1]!.content).toBe('turn 99')
  })

  it('truncates a single oversized turn rather than forwarding it whole', async () => {
    await chatPost(new Request('http://localhost/api/admin/chat', {
      method: 'POST',
      body: JSON.stringify({ context_type: 'general', messages: [{ role: 'user', content: 'x'.repeat(200_000) }] }),
    }))

    const sent = (engine.createAdminChatStream.mock.calls[0]![0] as StreamOptions).messages
    expect(sent[0]!.content.length).toBeLessThan(200_000)
  })
})
