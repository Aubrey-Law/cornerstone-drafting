import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { leadNextMeetingDate } from '@/components/leads/LeadOverview'

beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-09-11T00:30:00Z')))
afterEach(() => vi.useRealTimers())

it('hides a past milestone instead of presenting it as the next meeting', () => {
  expect(leadNextMeetingDate('2026-09-09', 'America/New_York')).toBe('No meeting scheduled')
})

it('keeps date-only today visible using the firm calendar date near UTC midnight', () => {
  expect(leadNextMeetingDate('2026-09-10', 'America/New_York')).toBe('Sep 10, 2026')
  expect(leadNextMeetingDate('2026-09-10', 'Europe/London')).toBe('No meeting scheduled')
})

it('hides timed meetings strictly before now, including earlier on the same day', () => {
  expect(leadNextMeetingDate('2026-09-11T00:29:59Z', 'America/New_York')).toBe('No meeting scheduled')
  expect(leadNextMeetingDate('2026-09-11T00:30:00Z', 'America/New_York')).toContain('Sep 10, 2026')
  expect(leadNextMeetingDate('2026-09-11T01:00:00Z', 'America/New_York')).toContain('9:00 PM')
})

it.each([null, undefined, '', 'invalid'])('handles absent or invalid meeting %s', value => {
  expect(leadNextMeetingDate(value, 'America/New_York')).toBe('No meeting scheduled')
})
