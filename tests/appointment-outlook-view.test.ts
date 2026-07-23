import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/microsoftCalendar', () => ({
  getAccessToken: vi.fn(),
  getMicrosoftConnectionForUser: vi.fn(),
}))

import { mapGraphCalendarView } from '@/lib/appointments/graphEvents'

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
