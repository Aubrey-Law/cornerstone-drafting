import { describe, expect, it } from 'vitest'
import { answerForFinding, isActionable, runAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'

function finding(over: Partial<FieldAuditFinding> = {}): FieldAuditFinding {
  return {
    checkNumber: '1',
    outcome: 'deviation',
    severity: 'blocker',
    rationale: 'The residuary never answers the stated concern.',
    references: [
      {
        fieldKey: 'concerns',
        claimedValue: 'worried about the stepchildren',
        actualValue: 'worried about the stepchildren',
        matchedPath: null,
        verification: 'verified',
      },
    ],
    ...over,
  }
}

describe('isActionable', () => {
  it('is true for a deviation with a verified reference', () => {
    expect(isActionable(finding())).toBe(true)
  })

  it('is true for an absent with a verified reference', () => {
    expect(isActionable(finding({ outcome: 'absent' }))).toBe(true)
  })

  it('is false when no reference verified', () => {
    expect(isActionable(finding({ references: [] }))).toBe(false)
    expect(
      isActionable(finding({ references: [{ ...finding().references[0], verification: 'unverified' }] })),
    ).toBe(false)
  })

  it('is false for compliant and not_applicable however well referenced', () => {
    expect(isActionable(finding({ outcome: 'compliant' }))).toBe(false)
    expect(isActionable(finding({ outcome: 'not_applicable' }))).toBe(false)
  })
})

describe('answerForFinding', () => {
  /**
   * The distinction the whole slice exists for. Both of these produce no task
   * row, and until now both were read as grounds for withdrawing an earlier
   * one — but `compliant` is evidence of absence and an uncitable deviation is
   * absence of evidence.
   */
  it('separates a cleared check from an uncitable one', () => {
    expect(answerForFinding(finding({ outcome: 'compliant' }), true)).toBe('cleared')
    expect(answerForFinding(finding({ outcome: 'not_applicable' }), true)).toBe('cleared')
    expect(answerForFinding(finding({ references: [] }), true)).toBe('inconclusive')
  })

  it('calls a gated deviation actionable', () => {
    expect(answerForFinding(finding(), true)).toBe('actionable')
  })

  /**
   * A unit whose step failed never answered, so it cannot retire its own
   * task. Measured on the real run this slice comes from: the model reached
   * the same conclusion twice and emitted references only once.
   */
  it('is inconclusive when the unit did not succeed, whatever the finding says', () => {
    expect(answerForFinding(finding({ outcome: 'compliant' }), false)).toBe('inconclusive')
    expect(answerForFinding(finding(), false)).toBe('inconclusive')
  })

  it('is inconclusive when there is no finding at all', () => {
    expect(answerForFinding(undefined, true)).toBe('inconclusive')
  })
})

describe('runAnswers', () => {
  it('answers every check the prompt version declares', () => {
    const answers = runAnswers({
      checkNumbers: ['1', '2', '3'],
      findings: [finding({ checkNumber: '1' }), finding({ checkNumber: '2', outcome: 'compliant' })],
      failedCheckNumbers: [],
    })
    expect(answers.byCheck).toEqual({ '1': 'actionable', '2': 'cleared', '3': 'inconclusive' })
  })

  it('is authoritative only when nothing is inconclusive', () => {
    const complete = runAnswers({
      checkNumbers: ['1', '2'],
      findings: [finding({ checkNumber: '1' }), finding({ checkNumber: '2', outcome: 'not_applicable' })],
      failedCheckNumbers: [],
    })
    expect(complete.authoritative).toBe(true)

    const partial = runAnswers({
      checkNumbers: ['1', '2'],
      findings: [finding({ checkNumber: '1' }), finding({ checkNumber: '2', references: [] })],
      failedCheckNumbers: [],
    })
    expect(partial.authoritative).toBe(false)
  })

  it('is not authoritative when a unit failed', () => {
    const answers = runAnswers({
      checkNumbers: ['1'],
      findings: [finding({ checkNumber: '1' })],
      failedCheckNumbers: ['1'],
    })
    expect(answers.byCheck['1']).toBe('inconclusive')
    expect(answers.authoritative).toBe(false)
  })

  /** A prompt with no checks cannot be a complete answer to anything. */
  it('is not authoritative with no checks', () => {
    expect(runAnswers({ checkNumbers: [], findings: [], failedCheckNumbers: [] }).authoritative).toBe(false)
  })
})
