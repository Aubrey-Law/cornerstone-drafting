import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/email/gmailRead', () => ({ htmlToText: (value: string) => value.replace(/<[^>]*>/g, '') }))
import { GET } from '@/app/api/admin/comms/email-history/route'
const id = '123e4567-e89b-42d3-a456-426614174000'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ err: null })
  mocks.from.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ eq: mocks.eq })
  mocks.eq.mockReturnValue({ order: mocks.order })
})
describe('Record email history', () => {
  it('returns only record scoped outbound logs and preserves suppressed status', async () => {
    mocks.order.mockResolvedValue({ data: [{ id: 'email-1', subject: 'Review', html: '<p>Review documents</p>', status: 'suppressed', to_email: 'client@example.test', sent_at: '2026-09-11T12:00:00Z' }], error: null })
    const response = await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))
    expect(mocks.eq).toHaveBeenCalledWith('lead_id', id)
    expect(await response.json()).toEqual([{ id: 'email-1', channel: 'email', direction: 'outbound', body: 'Review documents', meta: 'Review · suppressed', sender: 'To client@example.test', created_at: '2026-09-11T12:00:00Z' }])
  })
  it('uses the recorded creation time when historical email has no sent timestamp', async () => {
    mocks.order.mockResolvedValue({ data: [{ id: 'old-email', subject: 'Old email', html: '', status: 'sent', to_email: 'client@example.test', sent_at: null, created_at: '2026-08-01T12:00:00Z' }], error: null })
    const response = await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))
    expect((await response.json())[0].created_at).toBe('2026-08-01T12:00:00Z')
  })
  it('requires admin authentication before querying logs', async () => {
    mocks.auth.mockResolvedValue({ err: new Response('Unauthorized', { status: 401 }) })
    expect((await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))).status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('returns an error rather than an empty history when storage fails', async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } })
    expect((await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))).status).toBe(500)
  })
})
