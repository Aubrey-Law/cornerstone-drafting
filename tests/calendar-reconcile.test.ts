import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: vi.fn(),
  getGoogleConnectionForUser: vi.fn(),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

import { planCalendarReconciliation } from '@/lib/appointments/calendarReconcile'
import type { CalendarEventTimes } from '@/lib/appointments/calendarTypes'
import type { ReconcilableAppointment } from '@/lib/appointments/calendarReconcile'

function appointment(overrides: Partial<ReconcilableAppointment> = {}): ReconcilableAppointment {
  return {
    id: 'appt-1',
    start_time: '2026-08-10T14:00:00.000Z',
    end_time: '2026-08-10T15:00:00.000Z',
    status: 'scheduled',
    google_event_id: 'ev-1',
    ...overrides,
  }
}

function calendarEvents(...events: CalendarEventTimes[]): Map<string, CalendarEventTimes> {
  return new Map(events.map(event => [event.id, event]))
}

function event(overrides: Partial<CalendarEventTimes> = {}): CalendarEventTimes {
  return {
    id: 'ev-1',
    startIso: '2026-08-10T14:00:00.000Z',
    endIso: '2026-08-10T15:00:00.000Z',
    isCancelled: false,
    ...overrides,
  }
}

describe('planCalendarReconciliation', () => {
  it('does nothing when the calendar agrees with the appointment', () => {
    expect(planCalendarReconciliation([appointment()], calendarEvents(event()))).toEqual([])
  })

  it('moves the appointment when the calendar holds a different time', () => {
    const actions = planCalendarReconciliation(
      [appointment()],
      calendarEvents(event({ startIso: '2026-08-10T16:30:00.000Z', endIso: '2026-08-10T17:30:00.000Z' })),
    )
    expect(actions).toEqual([
      {
        appointmentId: 'appt-1',
        eventId: 'ev-1',
        kind: 'move',
        startIso: '2026-08-10T16:30:00.000Z',
        endIso: '2026-08-10T17:30:00.000Z',
      },
    ])
  })

  it('ignores sub-minute drift between Google and Postgres', () => {
    const actions = planCalendarReconciliation(
      [appointment()],
      calendarEvents(event({ startIso: '2026-08-10T14:00:30.000Z', endIso: '2026-08-10T15:00:20.000Z' })),
    )
    expect(actions).toEqual([])
  })

  it('cancels the appointment when the calendar cancelled the event', () => {
    const actions = planCalendarReconciliation(
      [appointment()],
      calendarEvents(event({ isCancelled: true })),
    )
    expect(actions).toEqual([{ appointmentId: 'appt-1', eventId: 'ev-1', kind: 'cancel' }])
  })

  it('rechecks rather than cancelling when the event is absent from the range', () => {
    const actions = planCalendarReconciliation([appointment()], calendarEvents())
    expect(actions).toEqual([{ appointmentId: 'appt-1', eventId: 'ev-1', kind: 'recheck' }])
  })

  it('leaves appointments the calendar does not own, or that are already closed, alone', () => {
    const actions = planCalendarReconciliation(
      [
        appointment({ id: 'no-event', google_event_id: null }),
        appointment({ id: 'already-cancelled', status: 'cancelled', google_event_id: 'ev-2' }),
        appointment({ id: 'no-show', status: 'no_show', google_event_id: 'ev-3' }),
      ],
      calendarEvents(),
    )
    expect(actions).toEqual([])
  })

  it('plans each appointment independently', () => {
    const actions = planCalendarReconciliation(
      [
        appointment({ id: 'moved', google_event_id: 'ev-moved' }),
        appointment({ id: 'gone', google_event_id: 'ev-gone' }),
        appointment({ id: 'agreed', google_event_id: 'ev-agreed' }),
      ],
      calendarEvents(
        event({ id: 'ev-moved', startIso: '2026-08-11T14:00:00.000Z', endIso: '2026-08-11T15:00:00.000Z' }),
        event({ id: 'ev-agreed' }),
      ),
    )
    expect(actions.map(a => [a.appointmentId, a.kind])).toEqual([
      ['moved', 'move'],
      ['gone', 'recheck'],
    ])
  })
})
