// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
const read = vi.hoisted(() => vi.fn())
vi.mock('@/lib/appointments/calendarSnapshot', () => ({ fetchCalendarSnapshot: read }))
vi.mock('@/lib/appointments/googleEvents', () => ({ mapCalendarView: () => [] }))
vi.mock('@/app/admin/components/RefreshTodayCalendar', () => ({ RefreshTodayCalendar: () => <button>Refresh calendar</button> }))
import { TodayCalendar } from '@/app/admin/components/TodayCalendar'
afterEach(cleanup)
describe('independent Today calendar', () => {
  it('does not report an empty day when the calendar fails', async () => {
    read.mockRejectedValueOnce(new Error('offline'))
    render(await TodayCalendar({ appointments: [], excludeIds: [] }))
    expect(screen.getByText(/Google Calendar is unavailable/)).toBeTruthy()
    expect(screen.queryByText(/Nothing scheduled/)).toBeNull()
  })
  it('labels partial and stale results instead of reporting an empty day', async () => {
    read.mockResolvedValueOnce({ result: { raw: [], truncated: false, skipped: [] }, stale: true, fetchedAt: '2026-09-10T12:00Z' })
    render(await TodayCalendar({ appointments: [], excludeIds: [], appointmentsError: true }))
    expect(screen.getByText(/Saved calendar snapshot.*Some calendars/)).toBeTruthy()
    expect(screen.queryByText(/Nothing scheduled/)).toBeNull()
  })
})
