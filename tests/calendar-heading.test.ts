import { describe, expect, it } from 'vitest'
import { formatPlanHeading, formatSpanHeading, monthChipStyle, weekWorkloadFromBody, zonedTimeInput } from '@/app/admin/calendar/calendarTime'

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

  it('treats a failed workload response as a failure, not a disconnected Google account', () => {
    expect(weekWorkloadFromBody(null)).toEqual({ status: 'failed', days: [] })
    expect(weekWorkloadFromBody({ googleStatus: 'unavailable', connected: false, days: [{ date: '2026-10-12' }] })).toEqual({
      status: 'unavailable',
      days: [{ date: '2026-10-12' }],
    })
  })

  it('drops category color on no-show and rescheduled month chips', () => {
    const category = { bg: 'var(--stage-work-bg)', text: 'var(--stage-work-text)', dot: 'var(--stage-work)' }
    expect(monthChipStyle('scheduled', category)?.background).toBe(category.bg)
    expect(monthChipStyle('no_show', category)).toBeUndefined()
    expect(monthChipStyle('rescheduled', category)).toBeUndefined()
    expect(monthChipStyle('cancelled', category)).toBeUndefined()
  })
})
