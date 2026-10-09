import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }), update: mocks.update }) }) }))
import { POST } from '@/app/api/admin/intake/track/route'
const request = (track = 'college_prep') => new NextRequest('http://localhost/api/admin/intake/track', { method: 'POST', body: JSON.stringify({ intakeId: 'intake', track }) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ err: null, userId: 'staff' })
  mocks.read.mockResolvedValue({ data: { id: 'intake', status: 'draft', intake_track: 'estate', form_version_id: 'pin' }, error: null })
  mocks.update.mockReturnValue({ eq: async () => ({ error: null }) })
})
it('refuses a track change on a draft pinned questionnaire', async () => {
  const response = await POST(request())
  expect(response.status).toBe(409)
  expect((await response.json()).error).toContain('saved questionnaire version')
  expect(mocks.update).not.toHaveBeenCalled()
})
it('allows a no-op for the same pinned draft track', async () => {
  expect((await POST(request('estate'))).status).toBe(200)
  expect(mocks.update).not.toHaveBeenCalled()
})
it('retains unpinned draft track switching', async () => {
  mocks.read.mockResolvedValue({ data: { id: 'intake', status: 'draft', intake_track: 'estate', form_version_id: null }, error: null })
  expect((await POST(request())).status).toBe(200)
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ intake_track: 'college_prep' }))
})
it('authorizes before reading or changing a questionnaire', async () => {
  mocks.auth.mockResolvedValue({ err: new Response('Forbidden', { status: 403 }) })
  expect((await POST(request())).status).toBe(403)
  expect(mocks.read).not.toHaveBeenCalled()
})
