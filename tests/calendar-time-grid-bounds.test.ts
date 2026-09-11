import { describe, expect, it } from 'vitest'
import {
  GRID_END_MIN,
  GRID_START_MIN,
  endMinutesOfDay,
  timeGridBounds,
} from '@/app/admin/calendar/timeGrid'
import type { CalendarAppointment, ExternalCalendarEvent } from '@/app/admin/calendar/types'

/** Local-time ISO for the test day, so the assertions are timezone-independent. */
function localIso(day: number, hour: number, minute = 0): string {
  return new Date(2026, 7, day, hour, minute).toISOString()
}

const DAY = new Date(2026, 7, 10)
const DAY_KEY = '2026-08-10'

function outlookEvent(overrides: Partial<ExternalCalendarEvent> = {}): ExternalCalendarEvent {
  return {
    id: 'ev-1',
    subject: 'Court hearing',
    startIso: localIso(10, 9),
    endIso: localIso(10, 10),
    isAllDay: false,
    showAs: 'busy',
    ...overrides,
  }
}

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'appt-1',
    startTime: localIso(10, 9),
    endTime: localIso(10, 10),
    status: 'scheduled',
    locationType: 'teams',
    secondAttendeeName: null,
    secondAttendeeEmail: null,
    attendeeName: 'Jane Alpha',
    attendeeEmail: 'jane@example.com',
    attendeePhone: null,
    notes: null,
    typeLabel: 'Discovery call',
    source: 'internal',
    calendarSynced: true,
    onlineMeetingUrl: null,
    linkedMatterId: null,
    linkedMatterNumber: null,
    linkedMatterStage: null,
    linkedMatterPlanType: null,
    linkedLeadId: null,
    ...overrides,
  }
}

function bounds(options: { appointments?: CalendarAppointment[]; outlook?: ExternalCalendarEvent[] } = {}) {
  return timeGridBounds(
    [DAY],
    new Map(options.appointments ? [[DAY_KEY, options.appointments]] : []),
    new Map(options.outlook ? [[DAY_KEY, options.outlook]] : []),
  )
}

describe('timeGridBounds', () => {
  it('keeps the business window when everything fits inside it', () => {
    expect(bounds({ outlook: [outlookEvent()] })).toEqual({
      startMin: GRID_START_MIN,
      endMin: GRID_END_MIN,
    })
    expect(bounds()).toEqual({ startMin: GRID_START_MIN, endMin: GRID_END_MIN })
  })

  it('widens to the hour for an Outlook event before the business day', () => {
    const early = bounds({
      outlook: [outlookEvent({ startIso: localIso(10, 6, 15), endIso: localIso(10, 7) })],
    })
    expect(early).toEqual({ startMin: 6 * 60, endMin: GRID_END_MIN })
  })

  it('widens to the hour for an Outlook event after the business day', () => {
    const late = bounds({
      outlook: [outlookEvent({ startIso: localIso(10, 20), endIso: localIso(10, 21, 30) })],
    })
    expect(late).toEqual({ startMin: GRID_START_MIN, endMin: 22 * 60 })
  })

  it('widens for appointments too, but ignores cancelled ones', () => {
    expect(
      bounds({ appointments: [appointment({ startTime: localIso(10, 5), endTime: localIso(10, 6) })] }),
    ).toEqual({ startMin: 5 * 60, endMin: GRID_END_MIN })

    expect(
      bounds({
        appointments: [
          appointment({ status: 'cancelled', startTime: localIso(10, 5), endTime: localIso(10, 6) }),
        ],
      }),
    ).toEqual({ startMin: GRID_START_MIN, endMin: GRID_END_MIN })
  })

  it('ignores all-day events, which render in their own header row', () => {
    expect(
      bounds({
        outlook: [outlookEvent({ isAllDay: true, startIso: '2026-08-10', endIso: '2026-08-11' })],
      }),
    ).toEqual({ startMin: GRID_START_MIN, endMin: GRID_END_MIN })
  })

  it('never runs past the end of the day for an event crossing midnight', () => {
    expect(
      bounds({ outlook: [outlookEvent({ startIso: localIso(10, 23), endIso: localIso(11, 1) })] }),
    ).toEqual({ startMin: GRID_START_MIN, endMin: 24 * 60 })
  })
})

describe('endMinutesOfDay', () => {
  it('returns minutes from the start day midnight', () => {
    expect(endMinutesOfDay(localIso(10, 9), localIso(10, 10, 30))).toBe(10 * 60 + 30)
  })

  it('clamps to end-of-day when the event runs into the next day', () => {
    expect(endMinutesOfDay(localIso(10, 23), localIso(11, 1))).toBe(24 * 60)
  })
})
