import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ calendar: vi.fn(), appointments: [] as Array<{ start_time: string; end_time: string; status: string }>, target: 240, gte: vi.fn(), settings: vi.fn(), workGraph: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: async () => ({ userId: 'staff' }) }))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: mocks.settings }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, gte: (column: string, value: string) => { mocks.gte(column, value); return q }, lte: () => q, lt: () => q, eq: () => q, in: () => q, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'appointments' ? mocks.appointments : [] }).then(resolve) }; return q
} }) }))
vi.mock('@/lib/appointments/googleEvents', () => ({ listCalendarView: mocks.calendar, mapCalendarView: () => [{ startIso: '2026-10-07T16:00Z', endIso: '2026-10-07T18:00Z', isAllDay: false }] }))
vi.mock('@/lib/queries/tasks', () => ({ fetchDueTasks: async () => [], fetchTasks: async () => [] }))
vi.mock('@/lib/firmSettings', () => ({ loadFirmSettings: async () => ({ calendarDailyTargetMinutes: mocks.target }) }))
vi.mock('@/lib/work/server', () => ({ fetchWorkGraphForUser: mocks.workGraph, fetchWorkPreferences: async () => ({}) }))
vi.mock('@/lib/work/plans', () => ({ fetchDailyPlan: async () => null }))
vi.mock('@/lib/work/planner', () => ({ createDailyPlanPreview: () => ({}) }))
vi.mock('@/lib/work/calendarPlan', () => ({ buildCalendarTodayPlan: () => ({}) }))
import { GET } from '@/app/api/admin/calendar/plan/route'
beforeEach(() => { vi.clearAllMocks(); mocks.workGraph.mockResolvedValue({ items: [], appointments: [] }); mocks.settings.mockResolvedValue({ timezone: 'America/New_York' }); mocks.calendar.mockResolvedValue({ raw: [], skipped: [], truncated: false }); mocks.appointments = [] })
describe('calendar week workload range', () => {
  it('covers all seven dates including weekends and uses total work against the shared target', async () => {
    const body = await (await GET(new NextRequest('http://localhost/api?from=2026-10-04&to=2026-10-11'))).json()
    expect(body.days.map((day: { date: string }) => day.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
    expect(body.days[3]).toMatchObject({ internalMinutes: 120, targetMinutes: 240 })
    expect(mocks.gte).toHaveBeenCalledWith('start_time', '2026-10-04T04:00:00.000Z')
  })
  it('skips the task graph for workload-only requests', async () => {
    const body = await (await GET(new NextRequest('http://localhost/api?from=2026-10-04&to=2026-10-11&workload=1'))).json()
    expect(body.days).toHaveLength(7)
    expect(body.today).toBeUndefined()
    expect(mocks.workGraph).not.toHaveBeenCalled()
  })
  it('does not represent partial Google results as a complete load', async () => {
    mocks.calendar.mockResolvedValue({ raw: [], skipped: ['Firm calendar'], truncated: true })
    expect(await (await GET(new NextRequest('http://localhost/api?from=2026-10-04&to=2026-10-11'))).json()).toMatchObject({ connected: false, googleStatus: 'partial', days: [] })
  })
  it('keeps Cornerstone workload when Google is unavailable', async () => {
    mocks.calendar.mockRejectedValue(new Error('Google Calendar is not connected'))
    mocks.appointments = [{ start_time: '2026-10-07T14:00:00.000Z', end_time: '2026-10-07T15:00:00.000Z', status: 'scheduled' }]
    const body = await (await GET(new NextRequest('http://localhost/api?from=2026-10-04&to=2026-10-11&workload=1'))).json()
    expect(body).toMatchObject({ connected: false, googleStatus: 'unavailable' })
    expect(body.days[3]).toMatchObject({ date: '2026-10-07', clientMinutes: 60, internalMinutes: 0 })
  })
  it('rejects malformed or excessive explicit ranges', async () => {
    for (const range of ['from=2026-02-30&to=2026-03-05', 'from=2026-10-04&to=2026-10-04', 'from=2026-10-04&to=2027-10-04']) expect((await GET(new NextRequest(`http://localhost/api?${range}`))).status).toBe(400)
  })
})
