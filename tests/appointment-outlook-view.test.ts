import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/microsoftCalendar', () => ({
  getAccessToken: vi.fn(),
  getMicrosoftConnectionForUser: vi.fn(),
}))

import { mapGraphCalendarView, mapGraphEventTimes } from '@/lib/appointments/graphEvents'

const NONE = new Set<string>()

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    subject: 'Court hearing',
    isAllDay: false,
    isCancelled: false,
    showAs: 'busy',
    start: { dateTime: '2026-08-10T14:00:00.0000000' },
    end: { dateTime: '2026-08-10T15:00:00.0000000' },
    ...overrides,
  }
}

describe('mapGraphCalendarView', () => {
  it('maps Graph naive-UTC datetimes to ISO instants', () => {
    const [event] = mapGraphCalendarView([rawEvent()], NONE)
    expect(event).toMatchObject({
      id: 'ev-1',
      subject: 'Court hearing',
      startIso: '2026-08-10T14:00:00.000Z',
      endIso: '2026-08-10T15:00:00.000Z',
      isAllDay: false,
      showAs: 'busy',
    })
  })

  it('excludes Cornerstone-booked events by id and series master id', () => {
    const events = mapGraphCalendarView(
      [
        rawEvent(),
        rawEvent({ id: 'ev-2' }),
        rawEvent({ id: 'ev-3-instance', seriesMasterId: 'ev-master' }),
      ],
      new Set(['ev-2', 'ev-master']),
    )
    expect(events.map(e => e.id)).toEqual(['ev-1'])
  })

  it('drops cancelled, id-less, and unparseable entries; defaults the subject', () => {
    const events = mapGraphCalendarView(
      [
        rawEvent({ isCancelled: true }),
        rawEvent({ id: undefined }),
        rawEvent({ id: 'ev-4', start: { dateTime: 'garbage' } }),
        rawEvent({ id: 'ev-5', subject: '   ' }),
        'not-an-object',
      ],
      NONE,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'ev-5', subject: '(no subject)' })
  })

  it('sorts by start time and tolerates non-array input', () => {
    const events = mapGraphCalendarView(
      [
        rawEvent({ id: 'late', start: { dateTime: '2026-08-10T18:00:00' }, end: { dateTime: '2026-08-10T19:00:00' } }),
        rawEvent({ id: 'early' }),
      ],
      NONE,
    )
    expect(events.map(e => e.id)).toEqual(['early', 'late'])
    expect(mapGraphCalendarView(null, NONE)).toEqual([])
    expect(mapGraphCalendarView({ value: [] }, NONE)).toEqual([])
  })
})

describe('mapGraphCalendarView calendar attribution', () => {
  it('carries the calendar each event came from', () => {
    const [event] = mapGraphCalendarView(
      [rawEvent({ calendarId: 'cal-court', calendarName: '  Court dates  ' })],
      NONE,
    )
    expect(event).toMatchObject({ calendarId: 'cal-court', calendarName: 'Court dates' })
  })

  it('nulls the calendar when Graph gave none', () => {
    const [event] = mapGraphCalendarView([rawEvent()], NONE)
    expect(event).toMatchObject({ calendarId: null, calendarName: null })
  })

  it('keeps one copy of an event visible on two calendars, preferring the first', () => {
    const events = mapGraphCalendarView(
      [
        rawEvent({ calendarId: 'cal-default', calendarName: 'Calendar' }),
        rawEvent({ calendarId: 'cal-shared', calendarName: 'Shared' }),
      ],
      NONE,
    )
    expect(events).toHaveLength(1)
    expect(events[0].calendarName).toBe('Calendar')
  })
})

describe('mapGraphEventTimes', () => {
  it('indexes every event by id, including Cornerstone-managed ones', () => {
    const times = mapGraphEventTimes([rawEvent({ id: 'ev-a' }), rawEvent({ id: 'ev-b' })])
    expect([...times.keys()].sort()).toEqual(['ev-a', 'ev-b'])
    expect(times.get('ev-a')).toEqual({
      id: 'ev-a',
      startIso: '2026-08-10T14:00:00.000Z',
      endIso: '2026-08-10T15:00:00.000Z',
      isCancelled: false,
    })
  })

  it('keeps cancelled events so the appointment row can be cancelled too', () => {
    const times = mapGraphEventTimes([rawEvent({ isCancelled: true })])
    expect(times.get('ev-1')?.isCancelled).toBe(true)
  })

  it('resolves a series master to its earliest occurrence, whatever the order', () => {
    const times = mapGraphEventTimes([
      rawEvent({
        id: 'ev-instance-2',
        seriesMasterId: 'ev-master',
        start: { dateTime: '2026-08-17T14:00:00' },
        end: { dateTime: '2026-08-17T15:00:00' },
      }),
      rawEvent({ id: 'ev-instance-1', seriesMasterId: 'ev-master' }),
    ])
    expect(times.get('ev-master')).toMatchObject({
      id: 'ev-master',
      startIso: '2026-08-10T14:00:00.000Z',
    })
    expect(times.get('ev-instance-2')?.startIso).toBe('2026-08-17T14:00:00.000Z')
  })

  it('skips entries without an id or with unparseable times', () => {
    const times = mapGraphEventTimes([
      rawEvent({ id: undefined }),
      rawEvent({ id: 'ev-bad', start: { dateTime: 'garbage' } }),
    ])
    expect(times.size).toBe(0)
    expect(mapGraphEventTimes(null).size).toBe(0)
  })
})
