import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { loadAnyRun } from '@/lib/runs/history'
import { loadFieldAuditFindings } from '@/lib/fieldAudit/history'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { statusFromSteps } from '@/lib/runs/steps'
import { RunProgressRefresh } from '@/app/admin/review/components/RunProgressRefresh'
import { FieldAuditRunView } from './FieldAuditRunView'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Field audit' }

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
    <div className="space-y-4">
      <RunProgressRefresh runStatus={statusFromSteps(run.steps)} />
      <PageHeader
        eyebrow="Field audit"
        title={run.promptSlug ? `${run.promptSlug} v${run.promptVersionNumber}` : 'Field audit'}
        description={
          <>
            {run.matterId ? (
              <Link href={`/admin/matters/${run.matterId}?tab=reviews`} className="font-medium text-primary hover:underline">
                {run.matterTitle}
              </Link>
            ) : (
              run.matterTitle
            )}{' '}
            · {findings.length} findings
            {run.failedCount > 0 ? ` · ${run.failedCount} checks failed` : ''}
            {run.finishedAt ? ` · ${finishedOn(run.finishedAt)}` : ''}
          </>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/field-audits">
                <ArrowLeft className="size-4" aria-hidden />
                All field audits
              </Link>
            </Button>
            {run.matterId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/matters/${run.matterId}?tab=reviews`}>Open matter</Link>
              </Button>
            ) : null}
          </>
        }
      />
      {/* A check that never ran is not a check that found nothing. */}
      {run.failures.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Did not run: {run.failures.map(failure => `check ${failure.ruleNumber} (${failure.reason})`).join(', ')}
        </p>
      ) : null}
      <FieldAuditRunView runId={run.runId} findings={findings} steps={run.steps} />
    </div>
  )
}
