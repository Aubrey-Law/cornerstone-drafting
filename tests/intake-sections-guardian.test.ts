import { describe, expect, it } from 'vitest'

import { getStepById, getStepErrors } from '@/lib/intakeSections'

describe('guardian intake validation', () => {
  it.each(['discuss_with_attorney', 'not_provided_yet'])(
    'allows submission when the client selects %s',
    (choice) => {
      const data = {
        has_minor_children: true,
        _review_choices: { guardian: choice },
      }

      expect(getStepErrors('guardian', data)).toEqual([])
      expect(getStepById('guardian')?.isComplete(data)).toBe(true)
    },
  )

  it('still requires an intentional response when no guardian or deferral choice is provided', () => {
    const data = { has_minor_children: true }

    expect(getStepErrors('guardian', data)).toMatchObject([
      {
        sectionId: 'guardian',
        message: 'Name a guardian for your minor children.',
        severity: 'error',
      },
    ])
    expect(getStepById('guardian')?.isComplete(data)).toBe(false)
  })
})
