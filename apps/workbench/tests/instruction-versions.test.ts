import { describe, expect, it } from 'vitest'
import {
  CURRENT_FIELD_AUDIT_INSTRUCTIONS_VERSION,
  FIELD_AUDIT_INSTRUCTIONS,
  fieldAuditInstructions,
  runFieldAudit,
} from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import {
  CURRENT_REVIEW_INSTRUCTIONS_VERSION,
  REVIEW_INSTRUCTIONS,
  reviewInstructions,
} from '@aubrey-law/citations/review/runReview'
import type { FieldAuditBody } from '@aubrey-law/citations/prompt/body'

const CHECK = {
  number: '1',
  statement: 'Every concern has a provision.',
  risk: 'blocker' as const,
  reads: ['concerns'],
  taskTemplate: { title: 'A concern is unanswered', description: 'Confirm it.', priority: 'high' as const },
}
const BODY: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
  checks: [CHECK],
  outputTarget: 'task_set',
}

describe('the instruction registries', () => {
  it('has a text for every current version', () => {
    expect(FIELD_AUDIT_INSTRUCTIONS[CURRENT_FIELD_AUDIT_INSTRUCTIONS_VERSION]).toBeTruthy()
    expect(REVIEW_INSTRUCTIONS[CURRENT_REVIEW_INSTRUCTIONS_VERSION]).toBeTruthy()
  })

  /** A bumped constant with no text would render `undefined` as the system
   *  prompt, which the model would answer anyway. */
  it('has no empty entry in either registry', () => {
    for (const [version, text] of Object.entries(FIELD_AUDIT_INSTRUCTIONS)) {
      expect(text.trim().length, `field audit v${version}`).toBeGreaterThan(0)
    }
    for (const [version, text] of Object.entries(REVIEW_INSTRUCTIONS)) {
      expect(text.trim().length, `review v${version}`).toBeGreaterThan(0)
    }
  })

  it('falls back to current for a run made before versioning', () => {
    expect(fieldAuditInstructions(null)).toBe(FIELD_AUDIT_INSTRUCTIONS[CURRENT_FIELD_AUDIT_INSTRUCTIONS_VERSION])
    expect(fieldAuditInstructions(undefined)).toBe(FIELD_AUDIT_INSTRUCTIONS[CURRENT_FIELD_AUDIT_INSTRUCTIONS_VERSION])
    expect(reviewInstructions(null)).toBe(REVIEW_INSTRUCTIONS[CURRENT_REVIEW_INSTRUCTIONS_VERSION])
  })

  /**
   * A hard error, not a fallback. A run pinning a version this build has lost
   * is a run nobody can honestly finish, and substituting different
   * instructions would answer a different question while the run still
   * reports its own version.
   */
  it('refuses a version it does not have, rather than substituting one', () => {
    expect(() => fieldAuditInstructions(99)).toThrow(/version 99/)
    expect(() => reviewInstructions(99)).toThrow(/version 99/)
  })
})

describe('the engine renders the version the run pinned', () => {
  /**
   * The whole property. Before this, the instructions were a module constant
   * read at the moment of the call — so a run retried after they changed got
   * a different question for the retried unit than its siblings answered,
   * with nothing recording that they differed.
   */
  it('sends the pinned text, not the current text', async () => {
    const seen: string[] = []
    await runFieldAudit(
      { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, instructionsVersion: 1 },
      BODY,
      {
        callModel: async (request) => {
          const system = (request as { system: { text: string }[] }).system
          seen.push(system[0].text)
          return {
            content: [
              {
                type: 'tool_use',
                name: 'report_field_audit_finding',
                input: { outcome: 'compliant', rationale: 'Fine.', references: [] },
              },
            ],
          } as never
        },
      },
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(FIELD_AUDIT_INSTRUCTIONS[1])
  })

  /** And it fails before spending a model call, not partway through a batch. */
  it('throws before calling the model when the version is unknown', async () => {
    let called = false
    await expect(
      runFieldAudit(
        { promptSlug: 's', promptVersion: 1, values: { concerns: 'x' }, instructionsVersion: 42 },
        BODY,
        {
          callModel: async () => {
            called = true
            return { content: [] } as never
          },
        },
      ),
    ).rejects.toThrow(/version 42/)
    expect(called).toBe(false)
  })
})
