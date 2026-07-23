import { describe, expect, it } from 'vitest'
import {
  computeSlots,
  isSlotAvailable,
  zonedTimeToUtcMs,
  type ComputeSlotsInput,
} from '@/lib/appointments/availability'
import {
  effectiveWeeklyHours,
  emptyWeeklyHours,
  resolveLocationType,
  sanitizeCustomWeeklyHours,
  sanitizeLocationTypes,
  type WeeklyHours,
} from '@/lib/appointments/types'

const TZ = 'America/New_York'

function hours(overrides: Partial<WeeklyHours> = {}): WeeklyHours {
  return { ...emptyWeeklyHours(), ...overrides }
}

function baseInput(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  // Monday 2026-07-20, viewed a week ahead. now = Mon Jul 13 09:00 ET.
  return {
    weeklyHours: hours({ mon: [{ start: '09:00', end: '12:00' }] }),
    timezone: TZ,
    durationMinutes: 30,
    bufferMinutes: 0,
    minNoticeHours: 0,
    horizonDays: 30,
    busy: [],
    now: new Date('2026-07-13T13:00:00Z'),
    rangeStart: new Date('2026-07-20T00:00:00Z'),
    rangeEnd: new Date('2026-07-21T00:00:00Z'),
    ...overrides,
  }
}

describe('zonedTimeToUtcMs', () => {
  it('converts ET wall time to UTC (EDT, -4)', () => {
    const ts = zonedTimeToUtcMs({ year: 2026, month: 7, day: 20, hour: 9, minute: 0 }, TZ)
    expect(new Date(ts).toISOString()).toBe('2026-07-20T13:00:00.000Z')
  })

  it('converts ET wall time to UTC (EST, -5)', () => {
    const ts = zonedTimeToUtcMs({ year: 2026, month: 1, day: 12, hour: 9, minute: 0 }, TZ)
    expect(new Date(ts).toISOString()).toBe('2026-01-12T14:00:00.000Z')
  })
})

describe('computeSlots', () => {
  it('expands a weekly window into stepped slots', () => {
    const slots = computeSlots(baseInput())
    // 09:00–12:00 ET, 30-min slots on a 30-min grid → 6 slots (last starts 11:30)
    expect(slots).toHaveLength(6)
    expect(slots[0]).toBe('2026-07-20T13:00:00.000Z') // 9:00 ET
    expect(slots[5]).toBe('2026-07-20T15:30:00.000Z') // 11:30 ET
  })

  it('requires the full duration to fit in the window', () => {
    const slots = computeSlots(baseInput({ durationMinutes: 120 }))
    // 2h meetings in a 3h window: starts 9:00, 9:30, 10:00 only
    expect(slots).toHaveLength(3)
    expect(slots.at(-1)).toBe('2026-07-20T14:00:00.000Z') // 10:00 ET
  })

  it('excludes busy overlaps', () => {
    const busyStart = Date.parse('2026-07-20T13:30:00Z') // 9:30 ET
    const busyEnd = Date.parse('2026-07-20T14:30:00Z') // 10:30 ET
    const slots = computeSlots(baseInput({ busy: [{ start: busyStart, end: busyEnd }] }))
    // Blocks 9:30 and 10:00; 9:00–9:30 is back-to-back (half-open) and stays
    expect(slots).toEqual([
      '2026-07-20T13:00:00.000Z',
      '2026-07-20T14:30:00.000Z',
      '2026-07-20T15:00:00.000Z',
      '2026-07-20T15:30:00.000Z',
    ])
  })

  it('applies buffers around busy blocks', () => {
    const busyStart = Date.parse('2026-07-20T14:00:00Z') // 10:00 ET
    const busyEnd = Date.parse('2026-07-20T14:30:00Z') // 10:30 ET
    const slots = computeSlots(
      baseInput({ busy: [{ start: busyStart, end: busyEnd }], bufferMinutes: 15 }),
    )
    // Buffered busy = 9:45–10:45 ET. Blocks 9:30, 10:00, 10:30; leaves 9:00, 11:00, 11:30
    expect(slots).toEqual([
      '2026-07-20T13:00:00.000Z',
      '2026-07-20T15:00:00.000Z',
      '2026-07-20T15:30:00.000Z',
    ])
  })

  it('enforces minimum notice', () => {
    const slots = computeSlots(
      baseInput({
        now: new Date('2026-07-20T13:15:00Z'), // 9:15 ET same day
        minNoticeHours: 1,
      }),
    )
    // Cutoff 10:15 ET → first slot 10:30
    expect(slots[0]).toBe('2026-07-20T14:30:00.000Z')
  })

  it('enforces the booking horizon', () => {
    const slots = computeSlots(
      baseInput({
        now: new Date('2026-07-13T13:00:00Z'),
        horizonDays: 5, // horizon ends Jul 18 — before the Mon Jul 20 range
      }),
    )
    expect(slots).toHaveLength(0)
  })

  it('returns nothing for days with no windows', () => {
    const slots = computeSlots(
      baseInput({
        weeklyHours: hours({ tue: [{ start: '09:00', end: '17:00' }] }), // range is a Monday
      }),
    )
    expect(slots).toHaveLength(0)
  })

  it('handles multiple windows in one day', () => {
    const slots = computeSlots(
      baseInput({
        weeklyHours: hours({
          mon: [
            { start: '09:00', end: '10:00' },
            { start: '14:00', end: '15:00' },
          ],
        }),
      }),
    )
    expect(slots).toEqual([
      '2026-07-20T13:00:00.000Z', // 9:00 ET
      '2026-07-20T13:30:00.000Z', // 9:30 ET
      '2026-07-20T18:00:00.000Z', // 14:00 ET
      '2026-07-20T18:30:00.000Z', // 14:30 ET
    ])
  })

  it('stays DST-safe across the November fall-back transition', () => {
    // Sun Nov 1 2026 is the US fall-back date; check Mon Nov 2 09:00 ET = 14:00 UTC (EST)
    const slots = computeSlots(
      baseInput({
        now: new Date('2026-10-26T12:00:00Z'),
        rangeStart: new Date('2026-11-02T00:00:00Z'),
        rangeEnd: new Date('2026-11-03T00:00:00Z'),
      }),
    )
    expect(slots[0]).toBe('2026-11-02T14:00:00.000Z')
  })

  it('ignores malformed windows', () => {
    const slots = computeSlots(
      baseInput({
        weeklyHours: hours({
          mon: [
            { start: 'not-a-time', end: '12:00' },
            { start: '11:00', end: '10:00' }, // inverted
          ],
        }),
      }),
    )
    expect(slots).toHaveLength(0)
  })
})

describe('isSlotAvailable', () => {
  const check = {
    weeklyHours: hours({ mon: [{ start: '09:00', end: '12:00' }] }),
    timezone: TZ,
    durationMinutes: 30,
    bufferMinutes: 0,
    minNoticeHours: 0,
    horizonDays: 30,
    busy: [],
    now: new Date('2026-07-13T13:00:00Z'),
  }

  it('accepts an offered slot', () => {
    expect(isSlotAvailable('2026-07-20T13:00:00.000Z', check)).toBe(true)
  })

  it('rejects an off-grid or out-of-window slot', () => {
    expect(isSlotAvailable('2026-07-20T13:10:00.000Z', check)).toBe(false)
    expect(isSlotAvailable('2026-07-20T20:00:00.000Z', check)).toBe(false)
  })

  it('rejects a busy slot', () => {
    expect(
      isSlotAvailable('2026-07-20T13:00:00.000Z', {
        ...check,
        busy: [{ start: Date.parse('2026-07-20T13:00:00Z'), end: Date.parse('2026-07-20T13:30:00Z') }],
      }),
    ).toBe(false)
  })

  it('rejects garbage input', () => {
    expect(isSlotAvailable('not-a-date', check)).toBe(false)
  })
})

describe('per-type custom hours', () => {
  const general = hours({ mon: [{ start: '09:00', end: '12:00' }] })

  it('effectiveWeeklyHours falls back to general hours', () => {
    expect(effectiveWeeklyHours(general, { customWeeklyHours: null })).toBe(general)
  })

  it('effectiveWeeklyHours prefers the type override', () => {
    const custom = hours({ tue: [{ start: '13:00', end: '15:00' }] })
    expect(effectiveWeeklyHours(general, { customWeeklyHours: custom })).toBe(custom)
  })

  it('a type limited to Tuesday offers no Monday slots', () => {
    const custom = hours({ tue: [{ start: '09:00', end: '12:00' }] })
    // Same Monday range as baseInput — general hours would offer 6 slots.
    expect(computeSlots(baseInput({ weeklyHours: custom }))).toHaveLength(0)
    // The following Tuesday is offered.
    const tuesday = computeSlots(
      baseInput({
        weeklyHours: custom,
        rangeStart: new Date('2026-07-21T00:00:00Z'),
        rangeEnd: new Date('2026-07-22T00:00:00Z'),
      }),
    )
    expect(tuesday[0]).toBe('2026-07-21T13:00:00.000Z') // 9:00 ET Tue
  })

  it('sanitizeCustomWeeklyHours parses valid hours', () => {
    const parsed = sanitizeCustomWeeklyHours({ sat: [{ start: '10:00', end: '13:00' }] })
    expect(parsed).not.toBeNull()
    expect(parsed?.sat).toEqual([{ start: '10:00', end: '13:00' }])
    expect(parsed?.mon).toEqual([])
  })

  it('sanitizeCustomWeeklyHours maps null, garbage, and windowless values to null', () => {
    expect(sanitizeCustomWeeklyHours(null)).toBeNull()
    expect(sanitizeCustomWeeklyHours('9-5')).toBeNull()
    expect(sanitizeCustomWeeklyHours({})).toBeNull()
    expect(sanitizeCustomWeeklyHours({ mon: [], tue: [{ start: 'noon', end: '15:00' }] })).toBeNull()
  })
})

describe('meeting formats', () => {
  it('sanitizeLocationTypes dedupes, validates, and falls back to the legacy format', () => {
    expect(sanitizeLocationTypes(['teams', 'phone', 'teams'], 'phone')).toEqual(['teams', 'phone'])
    expect(sanitizeLocationTypes(['fax', 'carrier_pigeon'], 'in_person')).toEqual(['in_person'])
    expect(sanitizeLocationTypes(null, 'teams')).toEqual(['teams'])
    expect(sanitizeLocationTypes(undefined, 'bogus' as never)).toEqual(['phone'])
  })

  it('resolveLocationType honors an allowed choice and falls back otherwise', () => {
    const type = { locationType: 'in_person', locationTypes: ['in_person', 'teams'] } as const
    expect(resolveLocationType('teams', type)).toBe('teams')
    expect(resolveLocationType('phone', type)).toBe('in_person') // not offered
    expect(resolveLocationType(null, type)).toBe('in_person')
    expect(resolveLocationType('garbage', type)).toBe('in_person')
  })
})
