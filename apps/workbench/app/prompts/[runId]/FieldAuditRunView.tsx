'use client'

import { useActionState } from 'react'
import type { FieldAuditOutcome } from '@aubrey-law/citations/fieldAudit/types'
import type { StoredFieldAuditFinding } from '@/lib/fieldAudit/history'
import type { RunStep } from '@/lib/runs/steps'
import { RunSteps } from '@/app/runs/RunSteps'
import { retryRun } from './actions'

const OUTCOME_LABEL: Record<FieldAuditOutcome, string> = {
  deviation: 'Deviation',
  absent: 'Absent',
  compliant: 'Compliant',
  not_applicable: 'Not applicable',
}

const SEVERITY_CLASS: Record<string, string> = {
  blocker: 'border-destructive/50 bg-destructive/10 text-destructive',
  high: 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  medium: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  low: 'border-border bg-muted text-muted-foreground',
}

/**
 * A recorded field audit, read back — the field-audit analogue of
 * `app/review/[runId]/StoredFindings.tsx`.
 *
 * A field audit has no document to render a finding against, so there is no
 * split-pane citation viewer here: each finding's evidence is its field
 * references, shown inline with `matchedPath` so a structured field's
 * provenance (which child, which asset) stays visible rather than being
 * flattened away.
 */
export function FieldAuditRunView({
  runId,
  findings,
  steps,
}: {
  runId: string
  findings: StoredFieldAuditFinding[]
  steps: RunStep[]
}) {
  const [retryState, submitRetry, retryPending] = useActionState(retryRun, { message: null })

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <ul className="space-y-3" data-testid="field-audit-findings">
        {findings.map((finding) => (
          <li
            key={finding.findingId}
            data-testid={`finding-${finding.checkNumber}`}
            className="space-y-2 rounded-md border border-border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Check {finding.checkNumber}</span>
              <span className="text-xs text-muted-foreground">{OUTCOME_LABEL[finding.outcome]}</span>
              {finding.severity ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS[finding.severity] ?? ''}`}
                >
                  {finding.severity}
                </span>
              ) : null}
            </div>
            <p>{finding.rationale}</p>
            {finding.references.length > 0 ? (
              <ul className="space-y-1 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
                {finding.references.map((reference, index) => (
                  <li key={`${reference.fieldKey}-${index}`}>
                    <span className="font-medium text-foreground">{reference.fieldKey}</span>
                    {': claimed '}
                    <span>{reference.claimedValue ?? '(empty)'}</span>
                    {', actual '}
                    <span>{reference.actualValue ?? '(empty)'}</span>
                    {reference.matchedPath ? (
                      <span className="ml-1">
                        (<span data-testid="matched-path">{reference.matchedPath}</span>)
                      </span>
                    ) : null}
                    <span className="ml-1">· {reference.verification}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Steps</h2>
        <RunSteps
          steps={steps}
          unitNoun="checks"
          retryPending={retryPending}
          retryMessage={retryState.message}
          onRetry={() => {
            const form = new FormData()
            form.set('runId', runId)
            submitRetry(form)
          }}
        />
      </div>
    </div>
  )
}
