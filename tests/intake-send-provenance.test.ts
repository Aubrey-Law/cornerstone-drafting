import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: async () => ({ err: null, userId: 'staff-1', user: { email: 'staff@example.com' } }) }))
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.send }))
vi.mock('@/lib/firmConfig', () => ({ getFirmConfig: () => ({ email: 'firm@example.com', firmName: 'Firm', attorneyShortName: 'Attorney' }) }))
vi.mock('@/lib/intake/standingLinks', () => ({ ensureStandingIntakeLink: async () => ({ url: 'https://example.com/intake/token' }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
import { POST } from '@/app/api/admin/intake/send/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockImplementation((table: string) => {
    const result = { data: table === 'matters' ? { id: 'matter-1', client_intake_id: 'intake-1' } : { id: 'intake-1', email: 'client@example.com', first_name: 'Jane', last_name: 'Doe', intake_track: 'estate' }, error: null }
    const chain = {
      select: () => chain, eq: () => chain, update: () => chain,
      maybeSingle: async () => result,
      insert: async () => ({ error: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return chain
  })
})

it.each(['sent', 'suppressed', 'redirected', 'logged', 'error'])('scopes an intake send to the lead and preserves %s delivery outcome', async status => {
  mocks.send.mockResolvedValue({ ok: status !== 'error', status })
  const result = await POST(new Request('http://local/api/admin/intake/send', { method: 'POST', body: JSON.stringify({ intakeId: 'intake-1' }) }))
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'intake-1', to: 'client@example.com' }))
  expect(mocks.send.mock.calls[0][0].matterId).toBeUndefined()
  expect((await result.json()).email).toBe(status)
  expect(mocks.send).toHaveBeenCalledOnce()
})

it('keeps matter-origin intake sends scoped to the matter', async () => {
  mocks.send.mockResolvedValue({ ok: true, status: 'sent' })
  await POST(new Request('http://local/api/admin/intake/send', { method: 'POST', body: JSON.stringify({ matterId: 'matter-1' }) }))
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ matterId: 'matter-1' }))
  expect(mocks.send.mock.calls[0][0].leadId).toBeUndefined()
})
