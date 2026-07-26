import { describe, expect, it } from 'vitest'
import { firmDateKey, FIRM_TIMEZONE } from '@/lib/firmDate'

/**
 * Evening appointments are the boundary case: after 8pm ET a timestamp is
 * already the *next* day in UTC, so `toISOString().split('T')[0]` reported
 * tomorrow's calendar day. For a signing date in a law practice that drives real
 * scheduling errors, so both lib/appointments/book.ts and lib/calcom/sync.ts
 * derive `date` columns through firmDateKey instead.
 */
describe('firm-timezone calendar days for appointments', () => {
  it('uses the firm timezone, not UTC, for evening appointments', () => {
    const eveningEt = '2026-08-12T20:00:00-04:00'

    expect(new Date(eveningEt).toISOString().split('T')[0]).toBe('2026-08-13') // the old bug
    expect(firmDateKey(eveningEt)).toBe('2026-08-12')
  })

  it('handles the late-evening EST boundary', () => {
    // 19:00 EST = 00:00 UTC the next day.
    expect(firmDateKey('2026-01-15T19:00:00-05:00')).toBe('2026-01-15')
  })

  it('keeps morning appointments on the same day', () => {
    expect(firmDateKey('2026-08-12T09:30:00-04:00')).toBe('2026-08-12')
  })

  it('returns null for an unparseable timestamp', () => {
    expect(firmDateKey('not-a-date')).toBeNull()
  })

  it('is pinned to the firm timezone constant', () => {
    expect(FIRM_TIMEZONE).toBe('America/New_York')
  })
})
