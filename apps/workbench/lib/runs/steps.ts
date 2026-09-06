export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed'

/**
 * The one `RunStatus`.
 *
 * `lib/review/persist.ts` and `lib/fieldAudit/persist.ts` each declared their
 * own, both `'completed' | 'partial' | 'failed'`, and neither admitted
 * `running` — which the database has always allowed and which a run now
 * genuinely is while its steps settle. Both are deleted in favour of this.
 */
export type RunStatus = 'running' | 'completed' | 'partial' | 'failed'

export interface RunStep {
  unitId: string
  status: StepStatus
  attempts: number
  sequence: number
}

/**
 * One answer to "how did this run go", read from what its units actually did.
 *
 * There used to be two of these — `runStatusFor` in the review's persistence
 * and `runStatusForAudit` in the audit's — computing the same thing from
 * finding and failure counts, and disagreeing: given no findings and no
 * failures the first said `failed` and the second `completed`. Neither case
 * was reachable, which is exactly why nobody noticed. Steps make the counts
 * unnecessary: the rows say what happened.
 */
export function statusFromSteps(steps: RunStep[]): RunStatus {
  if (steps.length === 0) return 'failed'
  if (steps.some((s) => s.status === 'pending' || s.status === 'running')) return 'running'
  const succeeded = steps.filter((s) => s.status === 'succeeded').length
  if (succeeded === steps.length) return 'completed'
  return succeeded === 0 ? 'failed' : 'partial'
}

/**
 * The units a retry re-runs: the ones that were attempted and failed.
 *
 * A `pending` step was never attempted, so running it would be a first attempt
 * wearing a retry's name — and its attempt count would say otherwise.
 */
export function unitsToRetry(steps: RunStep[]): string[] {
  return steps
    .filter((s) => s.status === 'failed')
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => s.unitId)
}
