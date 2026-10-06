import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), sendEmail: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/matters/[id]/send-email/route'

const matterId = '123e4567-e89b-42d3-a456-426614174000'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ err: null, userId: 'staff-1', user: { email: 'staff@example.test' } })
  mocks.sendEmail.mockResolvedValue({ ok: true, status: 'sent', providerMessageId: null, logId: 'log-1' })
  mocks.from.mockImplementation((table: string) => table === 'matters'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: matterId }, error: null }) }) }) }
    : { insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'activity-1' }, error: null }) }) }) })
})

it('tags the email log with the matter, so the send shows on its Messages tab', async () => {
  const req = new NextRequest(`http://local/api/admin/matters/${matterId}/send-email`, {
    method: 'POST',
    body: JSON.stringify({ to: 'client@example.test', subject: 'Signing', text: 'See you Thursday.' }),
  })
  const response = await POST(req, { params: Promise.resolve({ id: matterId }) })
  expect(response.status).toBe(200)
  expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ matterId }))
})
