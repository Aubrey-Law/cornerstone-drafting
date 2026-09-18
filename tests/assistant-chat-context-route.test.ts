import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c' } })),
}))

const chats = vi.hoisted(() => ({
  getAssistantChat: vi.fn(async () => ({ id: 'c1', user_id: 'user-1', title: 'T', context_type: 'general', context_id: null })),
  renameAssistantChat: vi.fn(async () => undefined),
  updateAssistantChatContext: vi.fn(async () => undefined),
  listAssistantChatMessages: vi.fn(async () => []),
}))
vi.mock('@/lib/assistantChats', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/assistantChats')>()),
  ...chats,
}))

const knowledge = vi.hoisted(() => ({
  searchMatterRecords: vi.fn(async () => [{ id: 'm1', type: 'matter', label: 'Chen Family Trust', client_name: 'Amy Chen' }]),
  describeRecord: vi.fn(async () => null as unknown),
  listAssistantChatMessages: undefined,
}))
vi.mock('@/lib/matterKnowledge', () => ({
  searchMatterRecords: (...args: unknown[]) => knowledge.searchMatterRecords(...(args as [])),
  describeRecord: (...args: unknown[]) => knowledge.describeRecord(...(args as [])),
}))

import { PATCH } from '@/app/api/admin/assistant/chats/[chatId]/route'
import { GET as searchRecords } from '@/app/api/admin/assistant/records/route'

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/admin/assistant/chats/c1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ chatId: 'c1' }) },
  )
}

beforeEach(() => vi.clearAllMocks())

describe('pointing an assistant chat at a matter or lead', () => {
  it('records the matter the attorney picked', async () => {
    const response = await patch({ context_type: 'matter', context_id: 'm1' })

    expect(response.status).toBe(200)
    expect(chats.updateAssistantChatContext).toHaveBeenCalledWith('c1', 'user-1', { contextType: 'matter', contextId: 'm1' })
  })

  it('clears the record when the chat goes back to general', async () => {
    await patch({ context_type: 'general' })

    expect(chats.updateAssistantChatContext).toHaveBeenCalledWith('c1', 'user-1', { contextType: 'general', contextId: null })
  })

  it('refuses a matter context without an id', async () => {
    const response = await patch({ context_type: 'matter' })

    expect(response.status).toBe(400)
    expect(chats.updateAssistantChatContext).not.toHaveBeenCalled()
  })

  it('still renames when only a title is sent', async () => {
    const response = await patch({ title: 'Chens — next steps' })

    expect(response.status).toBe(200)
    expect(chats.renameAssistantChat).toHaveBeenCalledWith('c1', 'user-1', 'Chens — next steps')
    expect(chats.updateAssistantChatContext).not.toHaveBeenCalled()
  })
})

describe('finding a record to attach', () => {
  it('searches by the attorney’s text and returns the matches', async () => {
    const response = await searchRecords(new Request('http://localhost/api/admin/assistant/records?query=chen'))
    const body = await response.json() as { records: Array<{ id: string }> }

    expect(knowledge.searchMatterRecords).toHaveBeenCalledWith('chen', 8)
    expect(body.records[0]!.id).toBe('m1')
  })

  it('rejects an empty search rather than listing every client', async () => {
    const response = await searchRecords(new Request('http://localhost/api/admin/assistant/records?query='))
    expect(response.status).toBe(400)
  })
})

describe('loading a chat tells the page what it is pointed at', () => {
  it('labels the matter so the header can name it', async () => {
    chats.getAssistantChat.mockResolvedValueOnce({ id: 'c1', user_id: 'user-1', title: 'T', context_type: 'matter', context_id: 'm1' } as never)
    knowledge.describeRecord = vi.fn(async () => ({ id: 'm1', type: 'matter', label: 'Chen Family Trust', url: '/admin/matters/m1' }))
    const { GET } = await import('@/app/api/admin/assistant/chats/[chatId]/route')

    const response = await GET(new Request('http://localhost/api/admin/assistant/chats/c1'), { params: Promise.resolve({ chatId: 'c1' }) })
    const body = await response.json() as { context?: { type: string; id: string | null; label: string | null } }

    expect(body.context).toEqual({ type: 'matter', id: 'm1', label: 'Chen Family Trust' })
  })
})

describe('resolving a deep-linked record', () => {
  it('labels a record by id so ?matter= links can name it', async () => {
    knowledge.describeRecord = vi.fn(async () => ({ id: 'm1', type: 'matter', label: 'Chen Family Trust · #24-018', url: '/admin/matters/m1' }))

    const response = await searchRecords(new Request('http://localhost/api/admin/assistant/records?id=m1'))
    const body = await response.json() as { record?: { label: string } }

    expect(body.record?.label).toBe('Chen Family Trust · #24-018')
  })

  it('answers 404 for an id that is neither a matter nor a lead', async () => {
    knowledge.describeRecord = vi.fn(async () => null)
    const response = await searchRecords(new Request('http://localhost/api/admin/assistant/records?id=nope'))
    expect(response.status).toBe(404)
  })
})
