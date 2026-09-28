import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { notFound } from 'next/navigation'
import { loadRun } from '@/lib/review/history'
import { loadScanSummaries } from '@/lib/review/scans'
import { isCitable } from '@/lib/review/order'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { loadLinkableMatters } from '@/lib/review/uploads'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { statusFromSteps } from '@/lib/runs/steps'
import { RunProgressRefresh } from '../components/RunProgressRefresh'
import { ScanHistoryList } from '../components/ScanHistoryList'
import { StoredFindings } from './StoredFindings'
import { UploadPanel } from './UploadPanel'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Review' }

/**
 * One saved review: its findings, each against the passage it cites in the
 * run's own stored text, with the attorney's decision on each. Ported from the
 * workbench's `/review/[runId]`; the same rows, read the same way.
 */
export default async function SavedReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireStaffPage()

  const { runId } = await params
  const client = reviewClient()
  const run = await loadRun(client, runId)
  // A field-audit run has no document or text layer for this page to show it against.
  if (!run || run.kind !== 'review') notFound()

  // Only a review of an upload offers linking and reviewing again; a filed
  // document is reviewed again from its matter.
  const uploadOptions = run.reviewUploadId
    ? {
        matters: await loadLinkableMatters(client),
        playbooks: (await loadPublishedPrompts(client))
          .filter(prompt => prompt.body.kind === 'review')
          .map(prompt => ({ slug: prompt.slug, title: prompt.title })),
      }
    : null

  // Issue spotting and proofreading run against this same saved copy.
  const scans = run.reviewUploadId ? await loadScanSummaries(client, { reviewUploadId: run.reviewUploadId }) : []

  const cited = run.findings.filter(isCitable).length
  const refused = run.findings.filter(f => f.citationRefusal !== null).length
  const matterId = run.matterId ?? run.uploadMatterId ?? null

  return (
    <div className="space-y-4">
      <RunProgressRefresh runStatus={statusFromSteps(run.steps)} />
      <PageHeader
        eyebrow="Review"
        title={run.promptSlug ? `${run.promptSlug} v${run.promptVersionNumber}` : `${run.kind} run`}
        description={
          run.reviewUploadId ? (
            <span data-testid="unfiled-document">
              <span className="text-foreground">{run.documentLabel ?? 'Uploaded document'}</span>{' '}
              <span className="text-xs">
                · {run.uploadFromWord ? 'from Word' : 'upload'}
                {run.uploadMatterTitle ? `, linked to ${run.uploadMatterTitle}` : ', not filed on a matter'}
              </span>
            </span>
          ) : (
            run.documentLabel ?? undefined
          )
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/review">
                <ArrowLeft className="size-4" aria-hidden />
                All reviews
              </Link>
            </Button>
            {matterId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/matters/${matterId}?tab=reviews`}>Open matter</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {run.findings.length} findings · {cited} cited · {refused} citations rejected
          {run.failedCount > 0 ? ` · ${run.failedCount} rules failed` : ''}
          {run.finishedAt ? ` · ${run.finishedAt.slice(0, 10)}` : ''}
        </p>
        {/* A rule that never ran is not a rule that found nothing, so it is named. */}
        {run.failures.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Did not run: {run.failures.map(failure => `rule ${failure.ruleNumber} (${failure.reason})`).join(', ')}
          </p>
        ) : null}
      </div>
      {run.reviewUploadId && uploadOptions ? (
        <UploadPanel
          runId={run.runId}
          reviewUploadId={run.reviewUploadId}
          linkedMatterId={run.uploadMatterId ?? null}
          linkedMatterTitle={run.uploadMatterTitle ?? null}
          filed={run.uploadFiled ?? false}
          fromWord={run.uploadFromWord ?? false}
          matters={uploadOptions.matters}
          playbooks={uploadOptions.playbooks}
        />
      ) : null}
      {scans.length > 0 ? (
        <Card className="gap-0 py-0" data-testid="run-scans">
          <CardHeader className="block space-y-1 border-b py-3 [.border-b]:pb-3">
            <CardTitle className="text-sm">Also checked with this copy</CardTitle>
          </CardHeader>
          <ScanHistoryList scans={scans} showDocument={false} />
        </Card>
      ) : null}
      <Card className="gap-0 overflow-hidden py-0">
        <StoredFindings runId={run.runId} findings={run.findings} layer={run.layer} steps={run.steps} />
      </Card>
    </div>
  )
}
