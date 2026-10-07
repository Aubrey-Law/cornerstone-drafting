// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DayAgenda } from '@/app/admin/calendar/DayAgenda'
import { LoadIndicator } from '@/app/admin/calendar/LoadIndicator'
import type { DayAvailability } from '@/app/admin/calendar/types'
afterEach(cleanup)
const availability: DayAvailability = { date: '2026-10-07', timezone: 'America/New_York', windows: [{ start: Date.parse('2026-10-07T13:00Z'), end: Date.parse('2026-10-07T21:00Z') }], busy: [{ start: Date.parse('2026-10-07T14:00Z'), end: Date.parse('2026-10-07T15:00Z') }], bufferMinutes: 15 }
const props = { date: new Date(2026, 9, 7), now: new Date('2026-10-07T14:30Z'), todayKey: '2026-10-07', appointments: [], calendarEvents: [], attention: [], rail: { datesThisWeek: [], followUps: [], openSlots: [] }, onDismissAttention: vi.fn(), onOpenAppointment: vi.fn(), onReschedule: vi.fn(), onBookSlot: vi.fn() }
describe('Day agenda enhancements', () => {
  it('uses authoritative busy data even with all visible categories filtered out', () => {
    render(<DayAgenda {...props} availability={availability} />)
    expect(screen.getByText(/1h booked · 5h 45m open for the rest of today/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Book' }))
    expect(props.onBookSlot).toHaveBeenCalledWith('2026-10-07T15:15:00.000Z')
    expect(screen.queryByText('Open time today')).not.toBeInTheDocument()
  })
  it('does not invent openings when availability is unknown', () => {
    render(<DayAgenda {...props} />)
    expect(screen.getByText(/Availability unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Book' })).not.toBeInTheDocument()
  })
  it('shows now only on today and historical wording for past days', () => {
    render(<DayAgenda {...props} date={new Date(2026, 9, 6)} availability={{ ...availability, date: '2026-10-06' }} />)
    expect(screen.queryByText(/Now/)).not.toBeInTheDocument()
    expect(screen.getByText(/past day/)).toBeInTheDocument()
    expect(screen.queryByText(/rest of today/)).not.toBeInTheDocument()
  })
  it('compares client plus internal work to the target and handles zero target', () => {
    const { rerender } = render(<LoadIndicator day={{ date: '2026-10-07', clientMinutes: 60, internalMinutes: 120, targetMinutes: 120, isToday: true }} count={1} />)
    expect(screen.getByText(/over target/)).toBeInTheDocument()
    rerender(<LoadIndicator day={{ date: '2026-10-07', clientMinutes: 60, internalMinutes: 120, targetMinutes: 0, isToday: true }} count={1} />)
    expect(screen.getByText(/no target/)).toBeInTheDocument()
  })
})
