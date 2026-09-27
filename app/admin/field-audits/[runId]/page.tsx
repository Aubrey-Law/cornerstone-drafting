import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadAnyRun } from '@/lib/runs/history'
import { loadFieldAuditFindings } from '@/lib/fieldAudit/history'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { statusFromSteps } from '@/lib/runs/steps'
import { RunProgressRefresh } from '@/app/admin/review/components/RunProgressRefresh'
import { FieldAuditRunView } from './FieldAuditRunView'

export const dynamic = 'force-dynamic'

const finishedOn = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/**
 * One field-audit run: its findings, the steps that produced them, and a
 * decision on each finding. Ported from the workbench's `/prompts/[runId]`.
 */
export default async function FieldAuditRunPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireStaffPage()

  const { runId } = await params
  const client = reviewClient()
  const run = await loadAnyRun(client, runId)
  // A review run has its own page — it has a document this one cannot show.
  if (!run || run.kind !== 'field_audit') notFound()

  const findings = await loadFieldAuditFindings(client, runId)

  return (
    <div className="flex flex-col">
      <RunProgressRefresh runStatus={statusFromSteps(run.steps)} />
      <header className="space-y-1 border-b border-border px-6 py-4">
        <Link href="/admin/field-audits" className="text-xs text-muted-foreground underline underline-offset-4">
          Field audits
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          {run.promptSlug ? `${run.promptSlug} v${run.promptVersionNumber}` : 'Field audit'}
        </h1>
        <p className="text-xs text-muted-foreground">
          {run.matterId ? (
            <Link href={`/admin/matters/${run.matterId}`} className="underline underline-offset-4">
              {run.matterTitle}
            </Link>
          ) : (
            run.matterTitle
          )}{' '}
          · {findings.length} findings
          {run.failedCount > 0 ? ` · ${run.failedCount} checks failed` : ''}
          {run.finishedAt ? ` · ${finishedOn(run.finishedAt)}` : ''}
        </p>
        {/* A check that never ran is not a check that found nothing. */}
        {run.failures.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Did not run: {run.failures.map(failure => `check ${failure.ruleNumber} (${failure.reason})`).join(', ')}
          </p>
        ) : null}
      </header>
      <FieldAuditRunView runId={run.runId} findings={findings} steps={run.steps} />
    </div>
  )
}
