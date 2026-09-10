import { beforeEach, describe, expect, it, vi } from 'vitest'
const { requireAdmin, sendOutboundSms } = vi.hoisted(() => ({ requireAdmin: vi.fn(), sendOutboundSms: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/sms/outbound', () => ({ sendOutboundSms }))
import { POST as lead } from '@/app/api/admin/leads/[id]/send-sms/route'
import { POST as matter } from '@/app/api/admin/matters/[id]/send-sms/route'
import { POST as contact } from '@/app/api/admin/contacts/[id]/send-sms/route'
import { GET as token } from '@/app/api/token/route'
beforeEach(() => { vi.clearAllMocks(); requireAdmin.mockResolvedValue({ err: null, userId: 'admin' }) })
describe('retired communication routes', () => {
  it.each([lead, matter, contact, token])('returns gone for authorized requests without sending', async route => {
    const result = await route(new Request('http://localhost') as never)
    expect(result.status).toBe(410)
    expect(sendOutboundSms).not.toHaveBeenCalled()
  })
  it.each([lead, matter, contact, token])('still requires authorization', async route => {
    requireAdmin.mockResolvedValue({ err: new Response(null, { status: 401 }) })
    expect((await route(new Request('http://localhost') as never)).status).toBe(401)
  })
})
