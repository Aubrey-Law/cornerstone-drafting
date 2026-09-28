'use client'

import { useActionState, useOptimistic, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { FieldAuditOutcome } from '@aubrey-law/citations/fieldAudit/types'
import type { StoredFieldAuditFinding } from '@/lib/fieldAudit/history'
import type { Disposition } from '@/lib/review/persist'
import { statusFromSteps, type RunStep } from '@/lib/runs/steps'
import { RunSteps } from '@/app/admin/review/components/RunSteps'
import { recordFieldAuditDisposition, retryRun } from './actions'
import { TONE_BADGE, TONE_NOTICE, severityTone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

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
    <div className="w-full max-w-3xl space-y-6">
      {decisionState.message ? (
        <p role="alert" className={TONE_NOTICE.danger}>
          {decisionState.message}
        </p>
      ) : null}
      <ul className="space-y-3" data-testid="field-audit-findings">
        {findings.map((finding) => (
          <li
            key={finding.findingId}
            data-testid={`finding-${finding.checkNumber}`}
            className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm shadow-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Check {finding.checkNumber}</span>
              <span className="text-xs text-muted-foreground">{OUTCOME_LABEL[finding.outcome]}</span>
              {finding.severity ? (
                <Badge variant="outline" className={cn('text-micro capitalize', TONE_BADGE[severityTone(finding.severity)])}>
                  {finding.severity}
                </Badge>
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
              <ul className="space-y-1 rounded-md bg-muted p-2 text-xs text-muted-foreground">
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
