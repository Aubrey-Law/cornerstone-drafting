import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), settings: vi.fn(), busy: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: mocks.settings }))
vi.mock('@/lib/appointments/calendarBusy', () => ({ fetchAllBusy: mocks.busy, AvailabilityUnavailableError: class extends Error {} }))
import { GET } from '@/app/api/admin/calendar/availability/route'
import { emptyWeeklyHours } from '@/lib/appointments/types'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: 'staff' })
  const weeklyHours = emptyWeeklyHours(); weeklyHours.mon = [{ start: '09:00', end: '17:00' }]
  mocks.settings.mockResolvedValue({ timezone: 'America/New_York', weeklyHours, dateOverrides: {}, bufferMinutes: 15 })
  mocks.busy.mockResolvedValue([{ start: Date.parse('2026-11-02T15:00Z'), end: Date.parse('2026-11-02T16:00Z') }])
})
describe('calendar availability contract', () => {
  it('authenticates before reading scheduling data', async () => {
    mocks.auth.mockResolvedValue({ err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await GET(new NextRequest('http://localhost/api?date=2026-11-02'))).status).toBe(401)
    expect(mocks.settings).not.toHaveBeenCalled()
  })
  it('rejects rolled dates', async () => {
    expect((await GET(new NextRequest('http://localhost/api?date=2026-02-30'))).status).toBe(400)
    expect(mocks.busy).not.toHaveBeenCalled()
  })
  it('returns unfiltered busy intervals and configured hours in the scheduling timezone', async () => {
    const response = await GET(new NextRequest('http://localhost/api?date=2026-11-02'))
    expect(await response.json()).toMatchObject({ date: '2026-11-02', connected: true, bufferMinutes: 15, windows: [{ start: Date.parse('2026-11-02T14:00Z'), end: Date.parse('2026-11-02T22:00Z') }] })
    expect(mocks.busy).toHaveBeenCalledWith(new Date('2026-11-02T05:00Z'), new Date('2026-11-03T05:00Z'))
  })
  it('fails closed when blocking calendars cannot be read', async () => {
    mocks.busy.mockRejectedValue(new Error('unreachable'))
    const response = await GET(new NextRequest('http://localhost/api?date=2026-11-02'))
    expect(await response.json()).toMatchObject({ connected: false, windows: [], busy: [], error: 'Availability unavailable' })
  })
})
