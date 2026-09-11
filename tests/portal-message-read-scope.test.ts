import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: true, owns: 'mine', error: false, filters: [] as unknown[][] }))
vi.mock('@/lib/apiAuth', () => ({ getBearerToken: () => 'synthetic', requireAdmin: async () => ({ err: mocks.admin ? null : new Response(null, { status: 403 }) }) }))
vi.mock('@/lib/portal/getMatterForUser', () => ({ getMatterForUser: async () => ({ id: mocks.owns }) }))
vi.mock('@/lib/portalNotifications', () => ({ notifyClientOfFirmMessage: vi.fn() }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  const query = {
    select: () => query, update: () => query,
    eq: (...args: unknown[]) => { mocks.filters.push(args); return query },
    is: (...args: unknown[]) => { mocks.filters.push(args); return query },
    in: (...args: unknown[]) => { mocks.filters.push(args); return query },
    order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: table === 'users' ? { role: mocks.admin ? 'attorney' : 'client' } : { id: 'latest' }, error: null }),
    then: (resolve: (result: unknown) => void) => resolve({ data: [], count: 7, error: mocks.error ? { message: 'offline' } : null }),
  }; return query
} }) }))
import { GET, PATCH } from '@/app/api/messages/route'
const id = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { mocks.admin = true; mocks.owns = 'mine'; mocks.error = false; mocks.filters = [] })
describe('portal message read boundaries', () => {
  it('returns a summary without downloading the full conversation', async () => {
    const result = await GET(new Request('http://localhost/api/messages?matter_id=mine&summary=1'))
    expect(await result.json()).toEqual({ latest: { id: 'latest' }, unread: 7 })
    expect(mocks.filters).toContainEqual(['matter_id', 'mine'])
  })
  it('rejects another client matter before returning a summary', async () => {
    mocks.admin = false
    expect((await GET(new Request('http://localhost/api/messages?matter_id=other&summary=1'))).status).toBe(403)
  })
  it('marks only displayed client message IDs within the named matter', async () => {
    const result = await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ matter_id: 'mine', message_ids: [id] }) }))
    expect(result.status).toBe(200)
    expect(mocks.filters).toEqual([['matter_id', 'mine'], ['sender_role', 'client'], ['read_at', null], ['id', [id]]])
  })
  it('refuses an unbounded mark-read request', async () => {
    expect((await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ matter_id: 'mine' }) }))).status).toBe(400)
  })
  it('reports a failed write instead of claiming messages were read', async () => {
    mocks.error = true
    expect((await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ matter_id: 'mine', message_ids: [id] }) }))).status).toBe(503)
  })
})
