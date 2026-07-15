import { describe, expect, it } from 'vitest'
import {
  nextConsumedDesignFocus,
  shouldApplyDesignInitialFocus,
  shouldConsumeDesignFocus,
  type DesignInitialFocus,
} from '@/lib/designFocusNavigation'

describe('design focus consumption', () => {
  it('allows the same blocker to be consumed again after the URL focus is cleared', () => {
    expect(shouldConsumeDesignFocus('trust-details:', null)).toBe(true)
    expect(shouldConsumeDesignFocus('trust-details:', 'trust-details:')).toBe(false)
    const reset = nextConsumedDesignFocus(null, 'trust-details:')
    expect(reset).toBeNull()
    expect(shouldConsumeDesignFocus('trust-details:', reset)).toBe(true)
  })
})

describe('shouldApplyDesignInitialFocus', () => {
  const focus: DesignInitialFocus = { sectionId: 'financial-poa', targetField: null }

  it('applies a fresh focus request when its target section is active', () => {
    expect(shouldApplyDesignInitialFocus(focus, 'financial-poa', null)).toBe(true)
  })

  it('does not apply without a focus request or active section', () => {
    expect(shouldApplyDesignInitialFocus(null, 'financial-poa', null)).toBe(false)
    expect(shouldApplyDesignInitialFocus(focus, null, null)).toBe(false)
  })

  it('does not apply while a different section is active', () => {
    expect(shouldApplyDesignInitialFocus(focus, 'will-details', null)).toBe(false)
  })

  it('does not re-apply an already-applied request when the section def is rebuilt after a sheet edit', () => {
    expect(shouldApplyDesignInitialFocus(focus, 'financial-poa', focus)).toBe(false)
  })

  it('applies again when the attorney re-clicks a blocker, which issues a new request object', () => {
    const reissued: DesignInitialFocus = { ...focus }
    expect(shouldApplyDesignInitialFocus(reissued, 'financial-poa', focus)).toBe(true)
  })
})
