import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { FieldAuditFinding, FieldAuditResult } from '@aubrey-law/citations/fieldAudit/types'
import type { Json } from '@aubrey-law/db-types'

/**
 * Recording a field audit so it outlives the page.
 *
 * Follows `lib/review/persist.ts`'s shape: a run row, then one row per
 * finding, then that finding's evidence underneath it. The one real
 * difference is what "evidence" means for each kind — a review cites offsets
 * into a text layer, an audit cites a claim against a design-sheet field —
 * and that difference is why this lives in its own module rather than as a
 * branch inside `saveRun`: the two would share almost nothing but the run row
 * and the finding loop, and forcing them into one function would mean every
 * reader has to hold both shapes in their head to follow either one.
 */
const asJson = (value: unknown): Json => value as Json

export type RunStatus = 'completed' | 'partial' | 'failed'

/**
 * The status is the one field a reader skims, so it may not overstate
 * coverage.
 *
 * A run that lost a check to a failed call but still produced findings from
 * the rest is `partial` — not `completed`, which would claim every check ran,
 * and not `failed`, which would bury the findings it did produce. `partial`
 * is the honest word for exactly that: it is what stops a run that reports
 * only its findings from reading as if it covered the whole prompt.
 *
 * A run that lost every check to a failure and produced nothing is `failed`
 * outright — there is nothing here for a person to act on, and calling that
 * `partial` would say a review happened when it did not.
 */
export function runStatusForAudit(counts: { findingCount: number; failedCount: number }): RunStatus {
  if (counts.failedCount === 0) return 'completed'
  if (counts.findingCount === 0) return 'failed'
  return 'partial'
}

export interface FindingRow {
  run_id: string
  rule_number: string
  outcome: string
  severity: string | null
  rationale: string
}

/** `workflow_findings` rows for a run's findings, keyed by check number in `rule_number`. */
export function findingRowsFor(runId: string, result: FieldAuditResult): FindingRow[] {
  return result.findings.map((finding) => ({
    run_id: runId,
    rule_number: finding.checkNumber,
    outcome: finding.outcome,
    severity: finding.severity,
    rationale: finding.rationale,
  }))
}

export interface ReferenceRow {
  finding_id: string
  field_key: string
  claimed_value: string | null
  actual_value: string | null
  matched_path: string | null
  verification: string
}

/**
 * `workflow_field_references` rows for one finding's evidence.
 *
 * Unlike `lib/review/persist.ts`'s citations — which stores only a verified
 * one, because an unverified citation is a claim the document was never shown
 * to support — every reference is stored here, verified or not.
 * `workflow_field_references.verification` exists precisely to carry that
 * distinction on the row, and a reference that failed verification is still
 * the reason a person can tell an `absent`/`deviation` finding apart from one
 * that never had support to begin with. `matched_path` is carried through
 * unchanged: it is what lets a reader of a structured field's reference (say,
 * `children[0].dob`) see which record a value actually came from, and losing
 * it here would make that provenance unrecoverable once the run leaves memory.
 */
export function referenceRowsFor(findingId: string, finding: FieldAuditFinding): ReferenceRow[] {
  return finding.references.map((reference) => ({
    finding_id: findingId,
    field_key: reference.fieldKey,
    claimed_value: reference.claimedValue,
    actual_value: reference.actualValue,
    matched_path: reference.matchedPath,
    verification: reference.verification,
  }))
}

export interface SaveAuditRunInput {
  matterId: string
  promptVersionId: string
  result: FieldAuditResult
  model: string | null
  userId: string
}

/**
 * Stores the run, its findings and every reference underneath them.
 *
 * `document_version_id` and `text_layer_id` are always null: a field audit
 * runs against a matter's declared facts, not a filed document, which is
 * exactly what `workflow_runs_review_needs_document` (see
 * 20261028000000_prompt_objects.sql) exists to make representable — that
 * constraint only binds `kind = 'review'`.
 */
export async function saveAuditRun(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveAuditRunInput,
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const sb = client

  const counts = {
    findingCount: input.result.findings.length,
    failedCount: input.result.failures.length,
  }
  const now = new Date().toISOString()

  const { data: runRow, error: runError } = await sb
    .from('workflow_runs')
    .insert({
      matter_id: input.matterId,
      document_version_id: null,
      text_layer_id: null,
      prompt_version_id: input.promptVersionId,
      kind: 'field_audit',
      model: input.model,
      status: runStatusForAudit(counts),
      rule_total: counts.findingCount + counts.failedCount,
      finding_count: counts.findingCount,
      failed_count: counts.failedCount,
      // Stored as `FieldAuditResult` names them (`checkNumber`, not `ruleNumber`)
      // — nothing downstream depends on a shared shape with a review run's
      // failures yet, so there is no reason to rename the field on the way in.
      failures: asJson(input.result.failures),
      started_at: now,
      finished_at: now,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (runError) return { ok: false, message: `Could not store the run: ${runError.message}` }

  const runId = String(runRow.id)

  // Written inline rather than by calling `findingRowsFor`/`referenceRowsFor`
  // above, even though the shape is identical: this codebase's offline column
  // safety net (tests/query-columns.test.ts, scripts/checkDbColumns.mjs) can
  // only see a column name written as a literal object passed straight to
  // `.insert(...)`, not one built by a helper and handed over as a value, and
  // not one inside an array — see scripts/lib/queryReferences.mjs.
  // `lib/ceremony/repository.ts` already accepts the same trade for the same
  // reason. The helpers above stay as the pure, unit-tested statement of what
  // each row should look like; this loop is what the database actually runs,
  // and must be kept matching them by hand. References are inserted one at a
  // time rather than batched for exactly this reason: `matched_path` is the
  // column this whole feature exists not to lose, and a batched array insert
  // would make it invisible to the one check that would catch a typo in its
  // name.
  for (const finding of input.result.findings) {
    const { data: findingRow, error: findingError } = await sb
      .from('workflow_findings')
      .insert({
        run_id: runId,
        rule_number: finding.checkNumber,
        outcome: finding.outcome,
        severity: finding.severity,
        rationale: finding.rationale,
      })
      .select('id')
      .single()
    if (findingError) return { ok: false, message: `Could not store a finding: ${findingError.message}` }

    const findingId = String(findingRow.id)
    for (const reference of finding.references) {
      const { error: referenceError } = await sb.from('workflow_field_references').insert({
        finding_id: findingId,
        field_key: reference.fieldKey,
        claimed_value: reference.claimedValue,
        actual_value: reference.actualValue,
        matched_path: reference.matchedPath,
        verification: reference.verification,
      })
      if (referenceError) return { ok: false, message: `Could not store a reference: ${referenceError.message}` }
    }
  }

  return { ok: true, runId }
}
