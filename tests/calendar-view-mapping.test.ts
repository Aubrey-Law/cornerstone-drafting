import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: vi.fn(),
  getGoogleConnectionForUser: vi.fn(),
}))

import { mapCalendarView, mapEventTimes } from '@/lib/appointments/googleEvents'

const NONE = new Set<string>()

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    summary: 'Court hearing',
    status: 'confirmed',
    start: { dateTime: '2026-08-10T14:00:00Z' },
    end: { dateTime: '2026-08-10T15:00:00Z' },
    ...overrides,
  }
}

describe('mapCalendarView', () => {
  it('maps Google datetimes to ISO instants', () => {
    const [event] = mapCalendarView([rawEvent()], NONE)
    expect(event).toMatchObject({
      id: 'ev-1',
      subject: 'Court hearing',
      startIso: '2026-08-10T14:00:00.000Z',
      endIso: '2026-08-10T15:00:00.000Z',
      isAllDay: false,
      showAs: 'busy',
    })
  })

  it('reads an offset datetime, not just UTC', () => {
    const [event] = mapCalendarView(
      [rawEvent({ start: { dateTime: '2026-08-10T10:00:00-04:00' } })],
      NONE,
    )
    expect(event.startIso).toBe('2026-08-10T14:00:00.000Z')
  })

  it('treats a date-only event as all day', () => {
    const [event] = mapCalendarView(
      [rawEvent({ start: { date: '2026-08-10' }, end: { date: '2026-08-11' } })],
      NONE,
    )
    expect(event).toMatchObject({ isAllDay: true, startIso: '2026-08-10T00:00:00.000Z' })
  })

  it('reports a transparent event as free, so it does not read as booked time', () => {
    const [event] = mapCalendarView([rawEvent({ transparency: 'transparent' })], NONE)
    expect(event.showAs).toBe('free')
  })

  it('excludes Cornerstone-booked events by id and recurring-series id', () => {
    const events = mapCalendarView(
      [
        rawEvent(),
        rawEvent({ id: 'ev-2' }),
        rawEvent({ id: 'ev-3-instance', recurringEventId: 'ev-series' }),
      ],
      new Set(['ev-2', 'ev-series']),
    )
    expect(events.map(e => e.id)).toEqual(['ev-1'])
  })

  it('drops cancelled, id-less, and unparseable entries; defaults the subject', () => {
    const events = mapCalendarView(
      [
        rawEvent({ status: 'cancelled' }),
        rawEvent({ id: undefined }),
        rawEvent({ id: 'ev-4', start: { dateTime: 'garbage' } }),
        rawEvent({ id: 'ev-5', summary: '   ' }),
        'not-an-object',
      ],
      NONE,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'ev-5', subject: '(no subject)' })
  })

  it('sorts by start time and tolerates non-array input', () => {
    const events = mapCalendarView(
      [
        rawEvent({
          id: 'late',
          start: { dateTime: '2026-08-10T18:00:00Z' },
          end: { dateTime: '2026-08-10T19:00:00Z' },
        }),
        rawEvent({ id: 'early' }),
      ],
      NONE,
    )
    expect(events.map(e => e.id)).toEqual(['early', 'late'])
    expect(mapCalendarView(null, NONE)).toEqual([])
    expect(mapCalendarView({ items: [] }, NONE)).toEqual([])
  })
})

describe('mapCalendarView calendar attribution', () => {
  it('carries the calendar each event came from', () => {
    const [event] = mapCalendarView(
      [rawEvent({ calendarId: 'cal-court', calendarName: '  Court dates  ' })],
      NONE,
    )
    expect(event).toMatchObject({ calendarId: 'cal-court', calendarName: 'Court dates' })
  })

  it('nulls the calendar when Google gave none', () => {
    const [event] = mapCalendarView([rawEvent()], NONE)
    expect(event).toMatchObject({ calendarId: null, calendarName: null })
  })

  it('keeps one copy of an event visible on two calendars, preferring the first', () => {
    const events = mapCalendarView(
      [
        rawEvent({ calendarId: 'primary', calendarName: 'Aubrey Law' }),
        rawEvent({ calendarId: 'cal-shared', calendarName: 'Shared' }),
      ],
      NONE,
    )
    expect(events).toHaveLength(1)
    expect(events[0].calendarName).toBe('Aubrey Law')
  })
})

describe('mapEventTimes', () => {
  it('indexes every event by id, including Cornerstone-managed ones', () => {
    const times = mapEventTimes([rawEvent({ id: 'ev-a' }), rawEvent({ id: 'ev-b' })])
    expect([...times.keys()].sort()).toEqual(['ev-a', 'ev-b'])
    expect(times.get('ev-a')).toEqual({
      id: 'ev-a',
      startIso: '2026-08-10T14:00:00.000Z',
      endIso: '2026-08-10T15:00:00.000Z',
      isCancelled: false,
    })
  })

  it('keeps cancelled events so the appointment row can be cancelled too', () => {
    const times = mapEventTimes([rawEvent({ status: 'cancelled' })])
    expect(times.get('ev-1')?.isCancelled).toBe(true)
  })

  it('resolves a recurring series to its earliest occurrence, whatever the order', () => {
    const times = mapEventTimes([
      rawEvent({
        id: 'ev-instance-2',
        recurringEventId: 'ev-series',
        start: { dateTime: '2026-08-17T14:00:00Z' },
        end: { dateTime: '2026-08-17T15:00:00Z' },
      }),
      rawEvent({ id: 'ev-instance-1', recurringEventId: 'ev-series' }),
    ])
    expect(times.get('ev-series')).toMatchObject({
      id: 'ev-series',
      startIso: '2026-08-10T14:00:00.000Z',
    })
    expect(times.get('ev-instance-2')?.startIso).toBe('2026-08-17T14:00:00.000Z')
  })

  it('skips entries without an id or with unparseable times', () => {
    const times = mapEventTimes([
      rawEvent({ id: undefined }),
      rawEvent({ id: 'ev-bad', start: { dateTime: 'garbage' } }),
    ])
    expect(times.size).toBe(0)
    expect(mapEventTimes(null).size).toBe(0)
  })
})
