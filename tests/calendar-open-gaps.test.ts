import { describe, expect, it } from 'vitest'
import { bookedMinutes, dateInstant, openGaps, workingDayWindows } from '@/lib/calendarAvailability'
import { emptyWeeklyHours } from '@/lib/appointments/types'
const min = 60_000
const window = [{ start: 0, end: 480 * min }]
describe('calendar open gaps', () => {
  it('merges overlaps and clips busy to hours without double counting', () => {
    const busy = [{ start: -60 * min, end: 120 * min }, { start: 60 * min, end: 180 * min }, { start: 400 * min, end: 600 * min }]
    expect(openGaps(window, busy)).toEqual([{ start: 180 * min, end: 400 * min }])
    expect(bookedMinutes(window, busy)).toBe(260)
  })
  it('clips today at now, pads busy and keeps split hours separate', () => {
    expect(openGaps([{ start: 0, end: 120 * min }, { start: 180 * min, end: 300 * min }], [{ start: 210 * min, end: 240 * min }], 60 * min, 10)).toEqual([{ start: 60 * min, end: 120 * min }, { start: 180 * min, end: 200 * min }, { start: 250 * min, end: 300 * min }])
    expect(openGaps(window, [{ start: -min, end: 600 * min }])).toEqual([])
  })
  it('uses configured date overrides and DST-safe day instants', () => {
    const hours = emptyWeeklyHours(); hours.mon = [{ start: '09:00', end: '17:00' }]
    expect(workingDayWindows('2026-10-05', 'America/New_York', hours, { '2026-10-05': [] })).toEqual([])
    expect(workingDayWindows('2026-10-05', 'America/New_York', hours, {})[0].start).toBe(Date.parse('2026-10-05T13:00:00Z'))
    expect(dateInstant('2026-11-02', 'America/New_York') - dateInstant('2026-11-01', 'America/New_York')).toBe(25 * 60 * min)
  })
})
