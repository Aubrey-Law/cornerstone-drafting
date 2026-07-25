import { describe, expect, it } from 'vitest'
import { formatDateDetail, formatDateTime } from '@/lib/utils'

describe('lead and matter detail date formatting', () => {
  it('shows Eastern time for stored timestamps', () => {
    expect(formatDateTime('2026-07-24T17:30:00.000Z')).toBe('7/24/2026 · 1:30 PM')
    expect(formatDateDetail('2026-07-24T17:30:00.000Z')).toBe('7/24/2026 · 1:30 PM')
  })

  it('does not invent a midnight time for date-only legal fields', () => {
    expect(formatDateDetail('2026-07-24')).toBe('7/24/2026')
  })
})
