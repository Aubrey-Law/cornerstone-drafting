import { describe, expect, it } from 'vitest'
import { describeSourceErrors } from '@/lib/work/sourceErrors'

describe('describeSourceErrors', () => {
  it('says nothing when every source loaded', () => {
    expect(describeSourceErrors([])).toBeNull()
  })

  it('names a failed source in plain language', () => {
    expect(describeSourceErrors(['future_tasks'])).toBe('Could not load tasks. The rest of this page is still usable.')
    expect(describeSourceErrors(['email', 'calendar'])).toBe('Could not load mail and calendar. The rest of this page is still usable.')
  })
})
