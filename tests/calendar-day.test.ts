import { expect, it } from 'vitest'
import { calendarAnchorDate } from '@/lib/calendarDay'
it('opens the requested calendar day and rejects malformed or impossible dates', () => {
  const fallback = new Date(2026, 8, 11)
  expect(calendarAnchorDate('2026-10-05', fallback).getDate()).toBe(5)
  expect(calendarAnchorDate('2026-10-05', fallback).getMonth()).toBe(9)
  for (const value of ['2026-02-31', 'not-a-date', '2026-13-01', null]) expect(calendarAnchorDate(value, fallback)).toEqual(fallback)
})
