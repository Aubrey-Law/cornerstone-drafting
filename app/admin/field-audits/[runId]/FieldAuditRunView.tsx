'use client'

import { useActionState, useOptimistic, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import type { FieldAuditOutcome } from '@aubrey-law/citations/fieldAudit/types'
import type { StoredFieldAuditFinding } from '@/lib/fieldAudit/history'
import type { Disposition } from '@/lib/review/persist'
import { statusFromSteps, type RunStep } from '@/lib/runs/steps'
import { RunSteps } from '@/app/admin/review/components/RunSteps'
import { recordFieldAuditDisposition, retryRun } from './actions'

const OUTCOME_LABEL: Record<FieldAuditOutcome, string> = {
  deviation: 'Deviation',
  absent: 'Absent',
  compliant: 'Compliant',
  not_applicable: 'Not applicable',
}

const DECISIONS: Array<{ value: Exclude<Disposition, 'open'>; label: string }> = [
  { value: 'accepted', label: 'Accept' },
  { value: 'rejected', label: 'Reject' },
  { value: 'deferred', label: 'Defer' },
]

const SEVERITY_CLASS: Record<string, string> = {
  blocker: 'border-destructive/50 bg-destructive/10 text-destructive',
  high: 'border-warning/60 bg-warning/15 text-warning',
  medium: 'border-warning/30 bg-warning/5 text-warning',
  low: 'border-border bg-muted text-muted-foreground',
}

/**
 * A recorded field audit, read back — the field-audit analogue of
 * `app/admin/review/[runId]/StoredFindings.tsx`, decisions included: accepting,
 * rejecting or deferring a blocker is what clears it from the workspace's list
 * of unresolved blockers.
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
  const [decisionState, submitDecision] = useActionState(recordFieldAuditDisposition, { message: null })
  const [, startTransition] = useTransition()
  // Shown at once, so a decision does not look ignored while it saves.
  const [decided, setDecided] = useOptimistic(
    Object.fromEntries(findings.map((finding) => [finding.findingId, finding.disposition])) as Record<string, Disposition>,
  )

  const decide = (findingId: string, choice: Exclude<Disposition, 'open'>) => {
    // Pressing the recorded decision again reopens the finding.
    const next: Disposition = decided[findingId] === choice ? 'open' : choice
    const form = new FormData()
    form.set('findingId', findingId)
    form.set('disposition', next)
    form.set('runId', runId)
    startTransition(() => {
      setDecided({ ...decided, [findingId]: next })
      submitDecision(form)
    })
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      {decisionState.message ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {decisionState.message}
        </p>
      ) : null}
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
              <span className="ml-auto flex gap-1" role="group" aria-label={`Decision on check ${finding.checkNumber}`}>
                {DECISIONS.map((decision) => (
                  <Button
                    key={decision.value}
                    type="button"
                    size="sm"
                    variant={decided[finding.findingId] === decision.value ? 'default' : 'outline'}
                    aria-pressed={decided[finding.findingId] === decision.value}
                    onClick={() => decide(finding.findingId, decision.value)}
                  >
                    {decision.label}
                  </Button>
                ))}
              </span>
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
          runStatus={statusFromSteps(steps)}
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
