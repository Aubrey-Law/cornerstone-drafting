import { describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({}))
import { resolveCalendarDate, resolveCalendarView } from '@/app/admin/calendar/useCalendarNavigation'

describe('calendar navigation resolution', () => {
  it('prefers a valid URL view, then saved preference, then Day', () => {
    expect(resolveCalendarView('month', 'week')).toBe('month')
    expect(resolveCalendarView('invalid', 'week')).toBe('week')
    expect(resolveCalendarView(null, 'invalid')).toBe('day')
  })
  it('rejects rolled dates and preserves initial date fallback', () => {
    const now = new Date('2026-10-07T15:00:00Z')
    expect(resolveCalendarDate('2026-02-30', '2026-10-09', now).getDate()).toBe(9)
    expect(resolveCalendarDate('2026-10-08', '2026-10-09', now).getDate()).toBe(8)
    expect(resolveCalendarDate(null, null, now).getDate()).toBe(7)
  })
})
