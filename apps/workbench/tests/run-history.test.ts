import { describe, expect, it } from 'vitest'
import { toAnyRun } from '@/lib/runs/history'

const runRow = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  matter_id: 'm-1',
  document_version_id: null,
  prompt_version_id: 'pv-1',
  kind: 'field_audit',
  status: 'completed',
  rule_total: 2,
  finding_count: 2,
  failed_count: 0,
  failures: [],
  finished_at: '2026-09-05T12:00:00Z',
  ...over,
})

const stepRow = (over: Record<string, unknown> = {}) => ({
  unit_id: '1',
  status: 'succeeded',
  attempts: 1,
  sequence: 0,
  last_error: null,
  finding_id: null,
  ...over,
})

describe('toAnyRun', () => {
  /**
   * `lib/review/history.ts`'s `toStoredRun` used to do
   * `String(runRow.document_version_id)`, which yields the literal string
   * "null" for a field audit — a run against a matter's declared facts, which
   * genuinely has no document. This is the bug that made a field-audit run
   * unreadable as anything but a review with a document named "null".
   */
  it('a field-audit run yields no document rather than a document named "null"', () => {
    const run = toAnyRun(runRow({ kind: 'field_audit', document_version_id: null }), [], null, null, null)
    expect(run.document).toBeNull()
  })

  it('a review run still yields its document', () => {
    const run = toAnyRun(
      runRow({ kind: 'review', document_version_id: 'v-1' }),
      [],
      null,
      { id: 'v-1', document_id: 'd-1', filename: 'draft.docx' },
      { id: 'd-1', name: 'Trust Agreement' },
    )
    expect(run.document).toEqual({ documentVersionId: 'v-1', documentName: 'Trust Agreement' })
  })

  it('falls back to the version filename when no filed document resolves', () => {
    const run = toAnyRun(
      runRow({ kind: 'review', document_version_id: 'v-1' }),
      [],
      null,
      { id: 'v-1', document_id: null, filename: 'draft.docx' },
      null,
    )
    expect(run.document).toEqual({ documentVersionId: 'v-1', documentName: 'draft.docx' })
  })

  it('steps come back in sequence order, not insertion order', () => {
    const run = toAnyRun(
      runRow(),
      [stepRow({ unit_id: '3', sequence: 2 }), stepRow({ unit_id: '1', sequence: 0 }), stepRow({ unit_id: '2', sequence: 1 })],
      null,
      null,
      null,
    )
    expect(run.steps.map((s) => s.unitId)).toEqual(['1', '2', '3'])
  })

  it('carries a failed step\'s error and attempt count', () => {
    const run = toAnyRun(
      runRow(),
      [stepRow({ unit_id: '1', status: 'failed', attempts: 3, last_error: 'overloaded' })],
      null,
      null,
      null,
    )
    expect(run.steps[0]).toMatchObject({ status: 'failed', attempts: 3, lastError: 'overloaded' })
  })

  it('names the prompt version and matter when passed the rows to join', () => {
    const run = toAnyRun(
      runRow(),
      [],
      { id: 'm-1', name: 'Estate of Alvarez' },
      null,
      null,
      { id: 'pv-1', prompt_id: 'p-1', version_number: 3 },
      { id: 'p-1', slug: 'design-sheet-audit' },
    )
    expect(run.matterTitle).toBe('Estate of Alvarez')
    expect(run.promptSlug).toBe('design-sheet-audit')
    expect(run.promptVersionNumber).toBe(3)
  })

  it('reports no prompt slug or version number when neither row is joined', () => {
    const run = toAnyRun(runRow(), [], null, null, null)
    expect(run.promptSlug).toBeNull()
    expect(run.promptVersionNumber).toBeNull()
  })

  /**
   * `lib/fieldAudit/persist.ts` stores a field audit's failures as
   * `{ checkNumber, reason }` (`FieldAuditResult['failures']`), while
   * `lib/review/persist.ts` stores a review's as `{ ruleNumber, reason }`.
   * Both name the same unit that did not run; `AnyRun.failures` reads either
   * key so a field audit's failed checks are not silently dropped by a
   * reader that only ever knew the review's key.
   */
  it('reads a field audit\'s failures, stored under checkNumber rather than ruleNumber', () => {
    const run = toAnyRun(
      runRow({ failures: [{ checkNumber: '4', reason: 'overloaded' }] }),
      [],
      null,
      null,
      null,
    )
    expect(run.failures).toEqual([{ ruleNumber: '4', reason: 'overloaded' }])
  })
})
