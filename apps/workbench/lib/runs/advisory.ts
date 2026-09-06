import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'

/**
 * Which findings a matter is warned about on `/prompts`, advisory only.
 *
 * The design-sheet audit now fires on a stage entry (see the migration
 * turning `fires_on_stage_entry` on for it), and the owner's decision,
 * documented in `docs/superpowers/specs/2026-09-06-stage-triggered-runs-design.md`,
 * is that a blocker finding never blocks a transition: both version 1 and
 * version 2 of that audit produced blocker-level false positives on a real
 * matter, and a hard gate would have stopped a well-drafted matter from
 * advancing on a wrong finding. So a transition always succeeds, and an
 * unresolved blocker is only surfaced here.
 *
 * "Unresolved" needs no new state. `workflow_findings.disposition` already
 * carries `open | accepted | rejected | deferred`, and `saveDisposition`
 * (`lib/review/persist.ts`) already writes it. Reusing it is the point:
 * dispositioning a false positive — accepting it, rejecting it, deferring it —
 * is exactly the action that clears it from this list. If an accepted or
 * rejected finding kept warning, the list would only ever grow and would stop
 * being read, which is the failure mode that makes an advisory worthless.
 *
 * `toBlockerAdvisories` is pure and is the whole gate: everything the list
 * shows or omits is decided here, tested directly, rather than left to
 * whatever a SQL filter happens to also apply.
 */

type Row = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** Outcomes a blocker is worth warning about. A `compliant` or `not_applicable` finding never is, whatever its severity. */
const WARNING_OUTCOMES = new Set(['deviation', 'absent'])

export interface BlockerAdvisory {
  findingId: string
  runId: string
  matterId: string
  ruleNumber: string
}

/**
 * `findings` as read from `workflow_findings` (or anything with the same
 * shape); `matterByRun` maps a run's id to the matter it ran against, the way
 * `loadUnresolvedBlockers` below resolves it from `workflow_runs`.
 *
 * A finding whose run has no known matter is dropped rather than surfaced
 * with a blank — that is a data inconsistency to notice elsewhere, not
 * something this advisory should show half of.
 */
export function toBlockerAdvisories(findings: readonly Row[], matterByRun: Record<string, string>): BlockerAdvisory[] {
  const advisories: BlockerAdvisory[] = []
  for (const finding of findings) {
    if (str(finding.severity) !== 'blocker') continue
    if (str(finding.disposition) !== 'open') continue
    const outcome = str(finding.outcome)
    if (!outcome || !WARNING_OUTCOMES.has(outcome)) continue

    const runId = str(finding.run_id)
    const matterId = runId ? matterByRun[runId] : undefined
    if (!runId || !matterId) continue

    advisories.push({
      findingId: String(finding.id),
      runId,
      matterId,
      ruleNumber: String(finding.rule_number ?? ''),
    })
  }
  return advisories
}

export interface UnresolvedBlocker {
  findingId: string
  runId: string
  matterId: string
  matterTitle: string
  ruleNumber: string
}

/**
 * Every unresolved blocker finding on record, matter named, newest first —
 * the list `/prompts` shows above the picker.
 *
 * The `.eq`/`.in` filters below narrow what comes over the wire; they are not
 * what decides which findings are advisories. `toBlockerAdvisories` above is
 * — every row this function fetches is passed through it, so a filter here
 * drifting out of step with that gate would only cost round-trip size, never
 * correctness.
 *
 * Two plain queries rather than a PostgREST embedded select, following
 * `lib/prompts/designSheet.ts`'s `loadMattersWithDesignSheets`: an embedded
 * form cannot be checked column-by-column by this codebase's offline column
 * safety net (`tests/query-columns.test.ts`, `scripts/checkDbColumns.mjs`).
 */
export async function loadUnresolvedBlockers(client: SupabaseClient<WorkbenchDatabase>): Promise<UnresolvedBlocker[]> {
  const sb = client

  const { data: findings, error: findingsError } = await sb
    .from('workflow_findings')
    .select('id, run_id, rule_number, outcome, severity, disposition')
    .eq('severity', 'blocker')
    .eq('disposition', 'open')
    .in('outcome', ['deviation', 'absent'])
  if (findingsError) throw new Error(`Could not load findings: ${findingsError.message}`)
  if (!findings || findings.length === 0) return []

  const runIds = [...new Set(findings.map((finding) => String(finding.run_id)))]
  const { data: runs, error: runsError } = await sb.from('workflow_runs').select('id, matter_id').in('id', runIds)
  if (runsError) throw new Error(`Could not load runs: ${runsError.message}`)

  const matterByRun: Record<string, string> = {}
  for (const run of runs ?? []) {
    matterByRun[String(run.id)] = String(run.matter_id)
  }

  const advisories = toBlockerAdvisories(findings, matterByRun)
  if (advisories.length === 0) return []

  const matterIds = [...new Set(advisories.map((advisory) => advisory.matterId))]
  const { data: matters, error: mattersError } = await sb.from('matters').select('id, name').in('id', matterIds)
  if (mattersError) throw new Error(`Could not load matters: ${mattersError.message}`)

  const titleByMatter = new Map((matters ?? []).map((matter) => [String(matter.id), str(matter.name) ?? 'Untitled matter']))

  return advisories.map((advisory) => ({
    ...advisory,
    matterTitle: titleByMatter.get(advisory.matterId) ?? 'Untitled matter',
  }))
}
