import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
    rpc: mocks.rpc,
  }),
}))

import { runSystemAutomation, systemRunIdempotencyKey } from '@/lib/automations/control'

describe('system automation control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('refuses unauthorized requests before touching control state', async () => {
    const execute = vi.fn()
    const response = await runSystemAutomation('daily-digest', new Request('http://localhost/api/cron/daily-digest'), execute)
    expect(response.status).toBe(401)
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('makes the kill switch prevent future execution', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'rule-1', mode: 'live', kill_switch: true, max_attempts: 3, consecutive_failures: 0 },
      error: null,
    })
    const execute = vi.fn()
    const response = await runSystemAutomation('daily-digest', new Request('http://localhost/api/cron/daily-digest', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }), execute)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ skipped: true, reason: 'paused' })
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('deduplicates delivery keys by schedule and UTC minute', () => {
    const request = new Request('http://localhost/api/cron/daily-digest', {
      headers: { 'x-vercel-cron-schedule': '0 12 * * 1-5' },
    })
    expect(systemRunIdempotencyKey('daily-digest', request, new Date('2026-10-01T12:00:59Z')))
      .toBe('system:daily-digest:0 12 * * 1-5:2026-10-01T12:00')
  })
})
