'use client'

import { Button } from '@aubrey-law/ui/button'
import type { RunStatus, RunStep } from '@/lib/runs/steps'

/**
 * What each unit of a run did, and what retrying it would cost.
 *
 * Shared between the review view (`app/review/[runId]/StoredFindings.tsx`)
 * and the field-audit view (`app/prompts/[runId]/FieldAuditRunView.tsx`): a
 * step is a rule against a document or a check against a matter, and neither
 * kind needs anything different shown about it.
 *
 * The retry control names what it will spend. It calls the model again —
 * once per failed unit, per `lib/runs/retry.ts` — and a button that only said
 * "Retry" would invite being pressed without that being a decision. It is
 * hidden entirely when nothing failed, because there is nothing a retry would
 * do — and hidden while the run itself is still `running`, whatever
 * individual steps say: a tick still holds this run, and a retry racing it
 * would fight over the same rows the tick is in the middle of writing.
 * `runStatus` is passed in rather than recomputed here from `steps`, so it
 * always agrees with whatever the caller already read back as the run's own
 * status (`lib/runs/steps.ts`'s `statusFromSteps` is the one place that
 * computes it from steps at all).
 */
export function RunSteps({
  steps,
  unitNoun,
  runStatus,
  onRetry,
  retryPending = false,
  retryMessage = null,
}: {
  steps: RunStep[]
  /** The run's own vocabulary for one of its units, plural: "checks" for a field audit, "rules" for a review. */
  unitNoun: string
  /** Whether the run has settled. Gates the retry control below. */
  runStatus: RunStatus
  onRetry?: () => void
  retryPending?: boolean
  retryMessage?: string | null
}) {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence)
  const failed = ordered.filter((step) => step.status === 'failed')
  // "Complete" here means settled, not "succeeded" — a failed step is not
  // still outstanding, and a progress line that never reached its total
  // because some steps failed would look like the run was stuck rather than
  // done.
  const settled = ordered.filter((step) => step.status === 'succeeded' || step.status === 'failed')
  const singularNoun = unitNoun.endsWith('s') ? unitNoun.slice(0, -1) : unitNoun
  const hasSettled = runStatus === 'completed' || runStatus === 'partial' || runStatus === 'failed'

  return (
    <div className="space-y-3" data-testid="run-steps">
      <p className="text-sm text-muted-foreground">
        {settled.length} of {ordered.length} complete
      </p>
      <ul className="divide-y divide-border border-y border-border text-sm">
        {ordered.map((step) => (
          <li key={step.unitId} className="space-y-1 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {singularNoun} {step.unitId}
              </span>
              <span className="text-xs text-muted-foreground">
                {step.status}
                {step.attempts > 0 ? ` · ${step.attempts} ${step.attempts === 1 ? 'attempt' : 'attempts'}` : ''}
              </span>
            </div>
            {step.status === 'failed' && step.lastError ? (
              <p className="text-xs text-destructive">{step.lastError}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {retryMessage ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {retryMessage}
        </p>
      ) : null}

      {hasSettled && failed.length > 0 && onRetry ? (
        <Button onClick={onRetry} disabled={retryPending}>
          {retryPending
            ? 'Retrying…'
            : `Retry ${failed.length} failed ${failed.length === 1 ? singularNoun : unitNoun}`}
        </Button>
      ) : null}
    </div>
  )
}
