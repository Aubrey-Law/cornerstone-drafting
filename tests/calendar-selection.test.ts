import { describe, expect, it } from 'vitest'

import {
  busyCalendarIds,
  sanitizeCalendarIds,
  staleBlockingIds,
  visibleCalendars,
} from '@/lib/appointments/calendarSelection'
import type { CalendarRef } from '@/lib/appointments/calendarTypes'

const PRIMARY: CalendarRef = { id: 'firm@example.com', name: 'Aubrey Law', isDefault: true }
const PERSONAL: CalendarRef = { id: 'personal@example.com', name: 'Personal', isDefault: false }
const HOLIDAYS: CalendarRef = { id: 'holidays@group.v.calendar.google.com', name: 'US Holidays', isDefault: false }
const ALL = [PRIMARY, PERSONAL, HOLIDAYS]

describe('visibleCalendars', () => {
  it('treats a calendar in neither array as visible', () => {
    expect(visibleCalendars(ALL, [])).toEqual(ALL)
  })

  it('drops a hidden secondary calendar', () => {
    expect(visibleCalendars(ALL, [HOLIDAYS.id])).toEqual([PRIMARY, PERSONAL])
  })

  // The primary calendar is what "connected" means: listCalendarView reads it
  // first and treats a failure there as fatal. Hiding it would break the view,
  // so the rule is enforced here rather than trusted to the UI.
  it('keeps the primary calendar even when its id is in the hidden list', () => {
    expect(visibleCalendars(ALL, [PRIMARY.id, HOLIDAYS.id])).toEqual([PRIMARY, PERSONAL])
  })

  it('ignores hidden ids that match no calendar', () => {
    expect(visibleCalendars(ALL, ['deleted@example.com'])).toEqual(ALL)
  })
})

describe('busyCalendarIds', () => {
  it('always includes primary', () => {
    expect(busyCalendarIds([])).toEqual(['primary'])
  })

  it('adds each blocking calendar after primary', () => {
    expect(busyCalendarIds([PERSONAL.id])).toEqual(['primary', PERSONAL.id])
  })

  it('collapses duplicates', () => {
    expect(busyCalendarIds([PERSONAL.id, PERSONAL.id, 'primary'])).toEqual(['primary', PERSONAL.id])
  })
})

describe('staleBlockingIds', () => {
  it('reports a blocking id that matches no live calendar', () => {
    expect(staleBlockingIds(ALL, [PERSONAL.id, 'deleted@example.com'])).toEqual(['deleted@example.com'])
  })

  it('reports nothing when every blocking id is live', () => {
    expect(staleBlockingIds(ALL, [PERSONAL.id])).toEqual([])
  })
})

describe('sanitizeCalendarIds', () => {
  it('keeps unique non-empty strings', () => {
    expect(sanitizeCalendarIds(['a', 'b', 'a', ' c '])).toEqual(['a', 'b', 'c'])
  })

  it('drops non-strings and blanks', () => {
    expect(sanitizeCalendarIds(['a', '', '   ', 3, null, undefined, {}])).toEqual(['a'])
  })

  it('returns an empty array for anything that is not an array', () => {
    expect(sanitizeCalendarIds(null)).toEqual([])
    expect(sanitizeCalendarIds('a')).toEqual([])
  })
})
