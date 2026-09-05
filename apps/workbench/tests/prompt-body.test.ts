import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'

const reviewBody = {
  kind: 'review' as const,
  inputs: [],
  rules: [{ number: '1', statement: 'Our exculpation language carves out gross negligence.', risk: 'high' as const }],
}

const auditBody = {
  kind: 'field_audit' as const,
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
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

  it('refuses a field audit body wearing the review kind', () => {
    // The database enforces this with a composite key; the schema is the same
    // rule stated where the author will meet it first.
    const crossed = { ...auditBody, kind: 'review' as const }
    expect(promptBodySchema.safeParse(crossed).success).toBe(false)
  })

  it('refuses a check that reads no fields', () => {
    // A check with no `reads` can produce no verifiable reference, so its
    // findings could never become tasks. Refuse it at authoring time.
    const noReads = { ...auditBody, checks: [{ ...auditBody.checks[0], reads: [] }] }
    expect(promptBodySchema.safeParse(noReads).success).toBe(false)
  })
})
