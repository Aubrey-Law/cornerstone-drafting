import { describe, expect, it } from 'vitest'
import { capacityAvailabilityLabel } from '@/lib/work/capacityPresentation'

describe('capacity presentation', () => {
  it('describes verified calendar capacity as available time', () => {
    expect(capacityAvailabilityLabel({
      capacityMinutes: 192,
      interruptionBufferPercent: 20,
      calendarUnavailable: false,
    })).toBe('3h 12m available after 20% buffer')
  })

  it('does not overstate capacity when external calendar availability is unavailable', () => {
    expect(capacityAvailabilityLabel({
      capacityMinutes: 192,
      interruptionBufferPercent: 20,
      calendarUnavailable: true,
    })).toBe('3h 12m from recorded appointments after 20% buffer')
  })
})
