import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { FieldAuditFinding, FieldAuditResult } from '@aubrey-law/citations/fieldAudit/types'
import type { Json } from '@aubrey-law/db-types'

/**
 * Recording a field audit's findings, once the engine has returned.
 *
 * The run row itself is opened before the engine starts and each unit's
 * outcome is written as it settles — see `lib/runs/record.ts`'s `openRun` and
 * `recordStep`, and `lib/fieldAudit/run.ts`, which wires them together. This
 * module is only the third phase: store what each unit produced and link it
 * back to the step that produced it.
 *
 * `runStatusForAudit` used to live here, computing the same thing
 * `runStatusFor` in `lib/review/persist.ts` computed — and disagreeing with
 * it. Both are gone in favour of `statusFromSteps` in `lib/runs/steps.ts`,
 * the one function that answers "how did this run go", read from the steps
 * themselves rather than from counts kept in step with them by hand in two
 * places.
 */
const asJson = (value: unknown): Json => value as Json

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

/**
 * Stores this run's findings and their evidence, and links each finding back
 * to the step that produced it: `finding_id` on `workflow_run_steps` is set
 * here, in this third phase, once a finding actually exists to point at —
 * not in the second, where a step is recorded from an outcome the engine
 * knows nothing about persistence.
 *
 * Also carries the run's failures onto `workflow_runs.failures`, the column
 * the run page has always read to show why a unit was lost. Steps now carry
 * the same information (`last_error`, keyed by `unit_id`), but this
 * restructure is about *when* a run is recorded, not what it shows — moving
 * that read to the steps is Task 9's job, not this one's.
 *
 * Written inline rather than by calling `findingRowsFor`/`referenceRowsFor`
 * above, even though the shape is identical: this codebase's offline column
 * safety net (tests/query-columns.test.ts, scripts/checkDbColumns.mjs) can
 * only see a column name written as a literal object passed straight to
 * `.insert(...)`, not one built by a helper and handed over as a value, and
 * not one inside an array — see scripts/lib/queryReferences.mjs.
 * `lib/ceremony/repository.ts` already accepts the same trade for the same
 * reason. The helpers above stay as the pure, unit-tested statement of what
 * each row should look like; this loop is what the database actually runs,
 * and must be kept matching them by hand. References are inserted one at a
 * time rather than batched for exactly this reason: `matched_path` is the
 * column this whole feature exists not to lose, and a batched array insert
 * would make it invisible to the one check that would catch a typo in its
 * name.
 */
export async function saveFindings(
  client: SupabaseClient<GeneratedDatabase>,
  runId: string,
  result: FieldAuditResult,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = client

  for (const finding of result.findings) {
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

    const { error: linkError } = await sb
      .from('workflow_run_steps')
      .update({ finding_id: findingId })
      .eq('run_id', runId)
      .eq('unit_id', finding.checkNumber)
    if (linkError) {
      return { ok: false, message: `Could not link the finding to its step: ${linkError.message}` }
    }
  }

  const { error: failuresError } = await sb
    .from('workflow_runs')
    .update({ failures: asJson(result.failures) })
    .eq('id', runId)
  if (failuresError) {
    return { ok: false, message: `Could not record the run's failures: ${failuresError.message}` }
  }

  return { ok: true }
}
