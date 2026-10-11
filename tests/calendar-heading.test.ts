import { describe, expect, it } from 'vitest'
import { formatPlanHeading, formatSpanHeading, zonedTimeInput } from '@/app/admin/calendar/calendarTime'

describe('calendar headings and firm clock', () => {
  it('keeps the month on a same-month week instead of splitting the year and day', () => {
    expect(formatSpanHeading(new Date(2026, 9, 11), new Date(2026, 9, 17))).toBe('October 11 – 17, 2026')
  })

  it('names both months and both years when the range crosses them', () => {
    expect(formatSpanHeading(new Date(2026, 8, 27), new Date(2026, 9, 3))).toBe('September 27 – October 3, 2026')
    expect(formatSpanHeading(new Date(2026, 11, 27), new Date(2027, 0, 2))).toBe('December 27, 2026 – January 2, 2027')
  })

  it('labels the plan as the next ten working days in the firm timezone', () => {
    expect(formatPlanHeading('2026-10-12', 'America/New_York')).toBe('October 12 – 23, 2026')
    expect(formatPlanHeading('2026-10-11', 'America/New_York')).toBe('October 12 – 23, 2026')
  })

  it('reads appointment times in the firm timezone', () => {
    expect(zonedTimeInput('2026-10-12T14:00:00.000Z', 'America/New_York')).toBe('10:00')
  })
})
