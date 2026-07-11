import { describe, expect, it } from 'vitest'
import { nextConsumedDesignFocus, shouldConsumeDesignFocus } from '@/lib/designFocusNavigation'

describe('design focus consumption', () => {
  it('allows the same blocker to be consumed again after the URL focus is cleared', () => {
    expect(shouldConsumeDesignFocus('trust-details:', null)).toBe(true)
    expect(shouldConsumeDesignFocus('trust-details:', 'trust-details:')).toBe(false)
    const reset = nextConsumedDesignFocus(null, 'trust-details:')
    expect(reset).toBeNull()
    expect(shouldConsumeDesignFocus('trust-details:', reset)).toBe(true)
  })
})
