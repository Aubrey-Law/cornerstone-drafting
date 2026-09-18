import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c' } })),
}))

const knowledge = vi.hoisted(() => ({
  resolveRecordMatterId: vi.fn(async (id: string) => (id === 'lead-3' ? 'matter-for-lead-3' : id === 'm1' ? 'm1' : null)),
}))
vi.mock('@/lib/matterKnowledge', () => knowledge)

const history = vi.hoisted(() => ({
  listMatterAssistantHistory: vi.fn(async () => [{ role: 'user', content: 'hi', createdAt: '2026-09-18T00:00:00Z' }]),
  appendMatterAssistantTurns: vi.fn(async () => undefined),
  clearMatterAssistantHistory: vi.fn(async () => undefined),
}))
vi.mock('@/lib/matterAssistantHistory', () => history)

import { GENERAL_THREAD_KEY, railThreadKey } from '@/lib/railChatHistory'
import { DELETE, GET, PATCH } from '@/app/api/admin/chat/history/route'

beforeEach(() => vi.clearAllMocks())

/**
 * The rail kept its general and lead threads in sessionStorage: a reload or a
 * second tab lost them, and only matter threads survived. All three now live
 * in the per-user thread store the matter thread already used.
 */
describe('which thread a rail context belongs to', () => {
  it('keeps one general thread per attorney', async () => {
    expect(await railThreadKey({ type: 'general' })).toBe(GENERAL_THREAD_KEY)
  })

  it('shares a matter thread with the Review step under the matter id', async () => {
    expect(await railThreadKey({ type: 'matter', id: 'm1' })).toBe('m1')
  })

  it('files a lead thread under its matter, so the thread follows the client when they hire', async () => {
    expect(await railThreadKey({ type: 'lead', id: 'lead-3' })).toBe('matter-for-lead-3')
  })

  it('still has a home for a lead whose matter cannot be resolved', async () => {
    expect(await railThreadKey({ type: 'lead', id: 'orphan' })).toBe('lead:orphan')
  })
})

const url = (query: string) => `http://localhost/api/admin/chat/history?${query}`

describe('the rail history route', () => {
  it('lists the thread for a context', async () => {
    const response = await GET(new Request(url('context_type=lead&context_id=lead-3')))
    const body = await response.json() as { turns: unknown[] }

    expect(history.listMatterAssistantHistory).toHaveBeenCalledWith(expect.anything(), 'matter-for-lead-3', 'user-1')
    expect(body.turns).toHaveLength(1)
  })

  it('appends completed turns under the resolved thread', async () => {
    const response = await PATCH(new Request(url(''), {
      method: 'PATCH',
      body: JSON.stringify({ context_type: 'general', turns: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }),
    }))

    expect(response.status).toBe(200)
    expect(history.appendMatterAssistantTurns).toHaveBeenCalledWith(expect.anything(), GENERAL_THREAD_KEY, 'user-1', [
      { role: 'user', content: 'q' }, { role: 'assistant', content: 'a' },
    ])
  })

  it('clears the thread for a context', async () => {
    const response = await DELETE(new Request(url('context_type=matter&context_id=m1'), { method: 'DELETE' }))
    expect(response.status).toBe(200)
    expect(history.clearMatterAssistantHistory).toHaveBeenCalledWith(expect.anything(), 'm1', 'user-1')
  })

  it('refuses a record context without an id, and an unknown context type', async () => {
    expect((await GET(new Request(url('context_type=matter')))).status).toBe(400)
    expect((await GET(new Request(url('context_type=bogus')))).status).toBe(400)
  })

  it('refuses an empty or oversized turn batch', async () => {
    const empty = await PATCH(new Request(url(''), { method: 'PATCH', body: JSON.stringify({ context_type: 'general', turns: [] }) }))
    expect(empty.status).toBe(400)
    const five = await PATCH(new Request(url(''), {
      method: 'PATCH',
      body: JSON.stringify({ context_type: 'general', turns: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x' })) }),
    }))
    expect(five.status).toBe(400)
  })
})
