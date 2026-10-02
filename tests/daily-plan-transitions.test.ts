import { describe, expect, it } from 'vitest'
import { validateDailyPlanTransition } from '@/lib/work/plans'

describe('daily plan state transitions', () => {
  it('only allows a draft to commit and a committed plan to close', () => {
    expect(() => validateDailyPlanTransition('draft', 'committed')).not.toThrow()
    expect(() => validateDailyPlanTransition('committed', 'closed')).not.toThrow()
  })

  it('prevents a closed day from being silently reopened or recommitted', () => {
    expect(() => validateDailyPlanTransition('closed', 'committed')).toThrow('Cannot change a closed daily plan')
    expect(() => validateDailyPlanTransition('closed', 'draft')).toThrow('Cannot change a closed daily plan')
    expect(() => validateDailyPlanTransition('committed', 'committed')).toThrow('Cannot change a committed daily plan')
  })
})
