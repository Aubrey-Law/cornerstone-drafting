import { describe, expect, it } from 'vitest'
import {
  aggregateWorkload,
  annotateSlots,
  deriveAppointmentAttention,
  nextWorkingDateKeys,
} from '@/lib/calendarProductivity'

const HOURS = {
  sun: [],
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
}

describe('calendar productivity', () => {
  it('derives red and amber prep attention from server facts', () => {
    const items = deriveAppointmentAttention({
      appointmentId: 'appt-1',
      attendeeName: 'Jordan Client',
      typeLabel: 'Signing appointment',
      matterId: 'matter-1',
      startsInHours: 2,
      intakeFlagCount: 2,
      designUnapproved: true,
      designBlockingCount: 3,
      signingTaskCount: 1,
      followUpOwed: false,
      nextAction: null,
    })
    expect(items.map(item => item.id)).toEqual([
      'appt-1:intake',
      'appt-1:design',
      'appt-1:signing',
    ])
    expect(items.every(item => item.severity === 'red')).toBe(true)
    expect(items[0].actions[0].href).toContain('tab=intake')
  })

  it('annotates working-hours slots and the client meeting ordinal across DST', () => {
    const slots = annotateSlots({
      slots: [
        '2026-03-09T13:00:00.000Z', // 9am EDT, day after the DST transition.
        '2026-03-09T22:00:00.000Z', // 6pm EDT.
      ],
      durationMinutes: 60,
      timezone: 'America/New_York',
      weeklyHours: HOURS,
      existingClientStarts: ['2026-03-09T14:00:00.000Z'],
      clientMeetingCap: 2,
    })
    expect(slots[0]).toMatchObject({ afterHours: false, meetingOrdinal: 2, overCap: false })
    expect(slots[1]).toMatchObject({ afterHours: true, meetingOrdinal: 2 })
  })

  it('aggregates client and internal workload against a target', () => {
    const result = aggregateWorkload(
      ['2026-07-30', '2026-07-31'],
      [
        { startIso: '2026-07-30T13:00:00Z', endIso: '2026-07-30T14:30:00Z', kind: 'client' },
        { startIso: '2026-07-30T15:00:00Z', endIso: '2026-07-30T17:00:00Z', kind: 'internal' },
      ],
      360,
      '2026-07-30',
    )
    expect(result[0]).toMatchObject({
      clientMinutes: 90,
      internalMinutes: 120,
      targetMinutes: 360,
      isToday: true,
    })
    expect(result[1].clientMinutes).toBe(0)
  })

  it('returns ten weekdays without duplicating the DST weekend', () => {
    const dates = nextWorkingDateKeys(new Date('2026-10-30T16:00:00Z'), 10, 'America/New_York')
    expect(dates).toHaveLength(10)
    expect(dates).not.toContain('2026-11-01')
    expect(new Set(dates).size).toBe(10)
  })
})
