import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'

const reviewBody = {
  kind: 'review' as const,
  inputs: [],
  rules: [{ number: '1', statement: 'Our exculpation language carves out gross negligence.', risk: 'high' as const }],
}

const auditBody = {
  kind: 'field_audit' as const,
  inputs: [
    { key: 'concerns', source: 'design_sheet.concerns', required: true },
    { key: 'goals_notes', source: 'design_sheet.goals_notes', required: false },
  ],
  checks: [
    {
      number: '1',
      statement: 'Every stated concern is answered somewhere in the plan.',
      risk: 'blocker' as const,
      reads: ['concerns', 'goals_notes'],
      taskTemplate: { title: 'Concern unanswered', description: 'Review the design sheet.', priority: 'high' },
    },
  ],
}

describe('the prompt body schema', () => {
  it('accepts a review body unchanged from the playbook shape', () => {
    expect(promptBodySchema.safeParse(reviewBody).success).toBe(true)
  })

  it('accepts a field audit body', () => {
    expect(promptBodySchema.safeParse(auditBody).success).toBe(true)
  })

  it('refuses a body whose kind and shape disagree', () => {
    // What this actually proves: a field-audit body labelled `review` has no
    // `rules`, so it is refused. It does NOT prove the union is discriminated
    // — both arms carry a literal `kind`, so a plain union refuses the same
    // input. The discriminated form is chosen for the error it reports, not
    // for what it accepts, and no assertion here can tell the two apart.
    const crossed = { ...auditBody, kind: 'review' as const }
    expect(promptBodySchema.safeParse(crossed).success).toBe(false)
  })

  it('lets the kind alone decide which arm applies', () => {
    // The property worth guaranteeing: when a body carries both arms' fields
    // and both are individually valid, `kind` selects the arm and the other
    // arm's data is dropped rather than carried along. A review body must not
    // be able to smuggle checks through, because a later task turns checks
    // into tasks on a real matter.
    const both = { ...reviewBody, ...auditBody, kind: 'review' as const }
    const asReview = promptBodySchema.safeParse(both)
    expect(asReview.success).toBe(true)
    if (asReview.success) {
      expect(asReview.data.kind).toBe('review')
      expect('checks' in asReview.data).toBe(false)
    }

    const asAudit = promptBodySchema.safeParse({ ...both, kind: 'field_audit' as const })
    expect(asAudit.success).toBe(true)
    if (asAudit.success) {
      expect(asAudit.data.kind).toBe('field_audit')
      expect('rules' in asAudit.data).toBe(false)
    }
  })

  it('refuses a check that reads no fields', () => {
    // A check with no `reads` can produce no verifiable reference, so its
    // findings could never become tasks. Refuse it at authoring time.
    const noReads = { ...auditBody, checks: [{ ...auditBody.checks[0], reads: [] }] }
    expect(promptBodySchema.safeParse(noReads).success).toBe(false)
  })

  it('refuses a body with nothing to run', () => {
    // Zero rules is a review that checks nothing and reports success; zero
    // checks is the same. Both must be refused rather than quietly passing.
    expect(promptBodySchema.safeParse({ ...reviewBody, rules: [] }).success).toBe(false)
    expect(promptBodySchema.safeParse({ ...auditBody, checks: [] }).success).toBe(false)
  })

  it('refuses a check that reads a field no input declares', () => {
    // A field nobody declared is never fetched, so it resolves to nothing —
    // and "nothing" is indistinguishable from a field that is genuinely
    // empty. A model claiming emptiness would be believed about a fact the
    // run never actually read.
    const undeclared = {
      ...auditBody,
      checks: [{ ...auditBody.checks[0], reads: ['concerns', 'never_declared'] }],
    }
    const result = promptBodySchema.safeParse(undeclared)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('never_declared')
    }
  })

  it('accepts a check reading every field its prompt declares', () => {
    const declared = {
      ...auditBody,
      inputs: [
        { key: 'concerns', source: 'design_sheet.concerns', required: true },
        { key: 'goals_notes', source: 'design_sheet.goals_notes', required: false },
      ],
      checks: [{ ...auditBody.checks[0], reads: ['concerns', 'goals_notes'] }],
    }
    expect(promptBodySchema.safeParse(declared).success).toBe(true)
  })
})
