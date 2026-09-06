'use client'

import { Button } from '@aubrey-law/ui/button'
import type { RunStep } from '@/lib/runs/steps'

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
 * do.
 */
export function RunSteps({
  steps,
  unitNoun,
  onRetry,
  retryPending = false,
  retryMessage = null,
}: {
  steps: RunStep[]
  /** The run's own vocabulary for one of its units, plural: "checks" for a field audit, "rules" for a review. */
  unitNoun: string
  onRetry?: () => void
  retryPending?: boolean
  retryMessage?: string | null
}) {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence)
  const failed = ordered.filter((step) => step.status === 'failed')
  const singularNoun = unitNoun.endsWith('s') ? unitNoun.slice(0, -1) : unitNoun

  return (
    <div className="space-y-3" data-testid="run-steps">
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

      {failed.length > 0 && onRetry ? (
        <Button onClick={onRetry} disabled={retryPending}>
          {retryPending
            ? 'Retrying…'
            : `Retry ${failed.length} failed ${failed.length === 1 ? singularNoun : unitNoun}`}
        </Button>
      ) : null}
    </div>
  )
}
