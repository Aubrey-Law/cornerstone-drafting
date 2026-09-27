import { describe, expect, it } from 'vitest'
import { findingRowsFor, referenceRowsFor } from '@/lib/fieldAudit/persist'
import { statusFromSteps, type RunStep } from '@/lib/runs/steps'
import type { FieldAuditFinding, FieldAuditResult } from '@aubrey-law/citations/fieldAudit/types'

/**
 * The pure helpers behind `saveFindings`, checked without a client — the same
 * split `lib/review/persist.ts`'s own tests would use if it had them: a row
 * shape is a function of data, and the database call is the only part that
 * needs a network.
 */

const step = (unitId: string, status: RunStep['status']): RunStep => ({
  unitId,
  status,
  attempts: 1,
  sequence: Number(unitId),
})

/**
 * `runStatusForAudit` used to live in `lib/fieldAudit/persist.ts`, computing
 * this from finding/failure counts. It disagreed with `runStatusFor`, its
 * counterpart in `lib/review/persist.ts`, on a run with zero findings and
 * zero failures — the first called that `failed`, the second `completed`.
 * `statusFromSteps` in `lib/runs/steps.ts` replaces both: it is the one
 * function either kind of run reads its status from now, computed from the
 * steps themselves rather than from counts kept in step with them by hand.
 */
describe("a field audit's run status, from its steps", () => {
  it('is completed when every check ran and produced a finding', () => {
    expect(
      statusFromSteps([step('1', 'succeeded'), step('2', 'succeeded'), step('3', 'succeeded'), step('4', 'succeeded')]),
    ).toBe('completed')
  })

  /**
   * A run that lost every check to a failed call learned nothing. Calling
   * that `partial` would bury the fact that it produced zero findings behind
   * a word that suggests it still partly worked.
   */
  it('is failed when everything failed and nothing was found', () => {
    expect(statusFromSteps([step('1', 'failed'), step('2', 'failed'), step('3', 'failed')])).toBe('failed')
  })

  /**
   * `partial` is the honest word precisely because it is the only one that
   * does not overstate coverage: some checks ran and produced findings, and
   * some did not run at all.
   */
  it('is partial when some checks failed but others still produced findings', () => {
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'succeeded'), step('3', 'failed')])).toBe('partial')
  })

  /**
   * This is the exact case the two old functions disagreed on. Neither was
   * reachable — a run always has at least one step once it opens — which is
   * exactly why the disagreement went unnoticed. `statusFromSteps` settles
   * it: nothing ran, so the honest word is `failed`, not `completed`.
   */
  it('is failed for a run with no steps at all, unlike the old runStatusForAudit', () => {
    expect(statusFromSteps([])).toBe('failed')
  })
})

const finding = (over: Partial<FieldAuditFinding> = {}): FieldAuditFinding => ({
  checkNumber: '1',
  outcome: 'deviation',
  severity: 'high',
  rationale: 'The sheet does not answer this concern.',
  references: [],
  ...over,
})

describe('findingRowsFor', () => {
  it('keys each row by its check number in rule_number', () => {
    const result: FieldAuditResult = {
      promptSlug: 'ma-design-sheet-audit',
      promptVersion: 1,
      findings: [
        finding({ checkNumber: '1', outcome: 'deviation', severity: 'high', rationale: 'x' }),
        finding({ checkNumber: '6', outcome: 'compliant', severity: null, rationale: 'y' }),
      ],
      failures: [],
    }

    expect(findingRowsFor('run-1', result)).toEqual([
      { run_id: 'run-1', rule_number: '1', outcome: 'deviation', severity: 'high', rationale: 'x' },
      { run_id: 'run-1', rule_number: '6', outcome: 'compliant', severity: null, rationale: 'y' },
    ])
  })

  it('produces no rows for a run with no findings', () => {
    const result: FieldAuditResult = { promptSlug: 's', promptVersion: 1, findings: [], failures: [] }
    expect(findingRowsFor('run-1', result)).toEqual([])
  })
})

describe('referenceRowsFor', () => {
  /**
   * The one property this whole feature exists not to lose: a reference into
   * a structured field (`children`, `assets`, ...) names which leaf inside it
   * a claim actually matched. Losing it here would make that provenance
   * unrecoverable the moment the run leaves memory.
   */
  it('carries matched_path through to the row for a structured field', () => {
    const withStructuredReference = finding({
      checkNumber: '2',
      references: [
        {
          fieldKey: 'children',
          claimedValue: '2019-01-01',
          actualValue: '2019-01-01',
          matchedPath: 'children[0].dob',
          verification: 'verified',
        },
      ],
    })

    expect(referenceRowsFor('finding-1', withStructuredReference)).toEqual([
      {
        finding_id: 'finding-1',
        field_key: 'children',
        claimed_value: '2019-01-01',
        actual_value: '2019-01-01',
        matched_path: 'children[0].dob',
        verification: 'verified',
      },
    ])
  })

  it('records a null matched_path for a scalar field', () => {
    const withScalarReference = finding({
      checkNumber: '5',
      references: [
        {
          fieldKey: 'spouse_citizenship',
          claimedValue: 'green card',
          actualValue: 'green card',
          matchedPath: null,
          verification: 'verified',
        },
      ],
    })

    expect(referenceRowsFor('finding-2', withScalarReference)[0].matched_path).toBeNull()
  })

  /**
   * Unlike `lib/review/persist.ts`'s citations, an unverified reference is
   * still stored — it is the record of a claim that did not hold up, not
   * nothing at all.
   */
  it('keeps an unverified reference rather than dropping it', () => {
    const withUnverified = finding({
      references: [
        {
          fieldKey: 'concerns',
          claimedValue: 'a promise never made',
          actualValue: 'the actual concern text',
          matchedPath: null,
          verification: 'unverified',
        },
      ],
    })

    const rows = referenceRowsFor('finding-3', withUnverified)
    expect(rows).toHaveLength(1)
    expect(rows[0].verification).toBe('unverified')
  })

  it('produces no rows for a finding with no references', () => {
    expect(referenceRowsFor('finding-4', finding({ references: [] }))).toEqual([])
  })
})
