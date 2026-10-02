import { describe, expect, it } from 'vitest'
import { getCalendarConfidence } from '@/lib/work/calendarConfidence'

describe('calendar confidence', () => {
  it('requires explicit attention when availability cannot be checked', () => {
    expect(getCalendarConfidence({ calendarUnavailable: true, planStatus: 'draft', calendarStatus: null })).toMatchObject({
      state: 'unavailable', message: expect.stringMatching(/before committing/i),
    })
  })

  it('downgrades a committed plan until every desired block is reserved', () => {
    expect(getCalendarConfidence({
      calendarUnavailable: false,
      planStatus: 'committed',
      calendarStatus: { desiredBlocks: 3, syncedBlocks: 1, pendingBlocks: 1, staleBlocks: 1 },
    })).toMatchObject({ state: 'needs_sync', message: expect.stringMatching(/1 of 3/i) })
  })

  it('accepts a committed plan only when its calendar blocks are fully reserved', () => {
    expect(getCalendarConfidence({
      calendarUnavailable: false,
      planStatus: 'committed',
      calendarStatus: { desiredBlocks: 2, syncedBlocks: 2, pendingBlocks: 0, staleBlocks: 0 },
    })).toEqual({ state: 'ready', message: null })
  })
})
