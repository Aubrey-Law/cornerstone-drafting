import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), insert: vi.fn(), select: vi.fn(), single: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
import { POST } from '@/app/api/admin/leads/[id]/activity/route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ err: null, userId: 'actor-1' })
  mocks.from.mockReturnValue({ insert: mocks.insert })
  mocks.insert.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ single: mocks.single })
  mocks.single.mockResolvedValue({ data: { id: 'call-1' }, error: null })
})
function request(body: unknown) { return new Request('http://local/api/admin/leads/lead-1/activity', { method: 'POST', body: JSON.stringify(body) }) }
it.each([['connected', 'Connected'], ['voicemail', 'Left voicemail'], ['no_answer', 'No answer'], ['wrong_number', 'Wrong number']])('stores %s outcome using existing activity columns', async (outcome, label) => {
  const result = await POST(request({ eventType: 'call_logged', outcome, detail: ' Discussed options ' }), { params: Promise.resolve({ id: 'lead-1' }) })
  expect(result.status).toBe(200)
  expect(mocks.insert).toHaveBeenCalledWith({ lead_id: 'lead-1', event_type: `call_${outcome}`, title: `Call logged: ${label}`, detail: 'Discussed options', actor_id: 'actor-1' })
})
it('rejects unsupported outcomes without creating an activity', async () => {
  const result = await POST(request({ eventType: 'call_logged', outcome: 'unknown' }), { params: Promise.resolve({ id: 'lead-1' }) })
  expect(result.status).toBe(400)
  expect(mocks.insert).not.toHaveBeenCalled()
})
it('reports failed persistence instead of a logged call', async () => {
  mocks.single.mockResolvedValue({ data: null, error: { message: 'Write failed' } })
  const result = await POST(request({ eventType: 'call_logged', outcome: 'no_answer' }), { params: Promise.resolve({ id: 'lead-1' }) })
  expect(result.status).toBe(500)
})
