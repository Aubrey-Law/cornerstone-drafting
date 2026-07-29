import { describe, expect, it } from 'vitest'

import { getStepById, getStepErrors, getStepIssues } from '@/lib/intakeSections'

describe.each([
  {
    stepId: 'fiduciaries',
    choiceKey: 'fiduciaries',
    expectedWarnings: 4,
  },
  {
    stepId: 'spouse_fiduciaries',
    choiceKey: 'spouse_fiduciaries',
    expectedWarnings: 3,
  },
])('$stepId intake validation', ({ stepId, choiceKey, expectedWarnings }) => {
  it.each(['discuss_with_attorney', 'not_provided_yet'])(
    'marks the section complete when the client selects %s',
    (choice) => {
      const data = {
        marital_status: 'married',
        _review_choices: { [choiceKey]: choice },
      }

      expect(getStepById(stepId)?.isComplete(data)).toBe(true)
    },
  )

  it('does not block submission when fiduciary fields are unanswered', () => {
    const data = { marital_status: 'married' }

    expect(getStepErrors(stepId, data)).toEqual([])
    expect(getStepIssues(stepId, data)).toHaveLength(expectedWarnings)
    expect(getStepIssues(stepId, data).every((issue) => issue.severity === 'warning')).toBe(true)
  })
})

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

  it.each(['discuss_with_attorney', 'not_provided_yet'])(
    'allows server-side submission validation with persisted choice %s',
    (choice) => {
      const data = {
        has_minor_children: true,
        review_choices: { guardian: choice },
      }

      expect(getStepErrors('guardian', data)).toEqual([])
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
