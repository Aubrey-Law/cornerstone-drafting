import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getAccessToken: vi.fn(),
  getGoogleConnectionForUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: mocks.getAccessToken,
  getGoogleConnectionForUser: mocks.getGoogleConnectionForUser,
}))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: vi.fn() }))

import { createCalendarHold } from '@/lib/appointments/googleEvents'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getGoogleConnectionForUser.mockResolvedValue({ user_id: 'user-1' })
  mocks.getAccessToken.mockResolvedValue('token')
  vi.stubGlobal('fetch', mocks.fetch)
})

describe('Google calendar hold idempotency', () => {
  it('uses a deterministic provider id and treats an existing event as the same write', async () => {
    mocks.fetch.mockResolvedValue(new Response('', { status: 409 }))

    const first = await createCalendarHold({
      title: 'Focus block',
      startIso: '2026-10-01T14:00:00.000Z',
      endIso: '2026-10-01T14:30:00.000Z',
      idempotencyKey: 'daily-plan:appointment-1',
    })
    const second = await createCalendarHold({
      title: 'Focus block',
      startIso: '2026-10-01T14:00:00.000Z',
      endIso: '2026-10-01T14:30:00.000Z',
      idempotencyKey: 'daily-plan:appointment-1',
    })

    const request = mocks.fetch.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(request.body)) as { id?: string }
    expect(payload.id).toMatch(/^[0-9a-f]{64}$/)
    expect(first.eventId).toBe(payload.id)
    expect(second.eventId).toBe(payload.id)
  })
})
