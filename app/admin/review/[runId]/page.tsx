import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadRun } from '@/lib/review/history'
import { isCitable } from '@/lib/review/order'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { loadLinkableMatters } from '@/lib/review/uploads'
import { loadPublishedPrompts } from '@/lib/prompts/repository'
import { statusFromSteps } from '@/lib/runs/steps'
import { RunProgressRefresh } from '../components/RunProgressRefresh'
import { StoredFindings } from './StoredFindings'
import { UploadPanel } from './UploadPanel'

export const dynamic = 'force-dynamic'

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

  const cited = run.findings.filter(isCitable).length
  const refused = run.findings.filter(f => f.citationRefusal !== null).length
  const matterId = run.matterId ?? run.uploadMatterId ?? null

  return (
    <div className="flex flex-col">
      <RunProgressRefresh runStatus={statusFromSteps(run.steps)} />
      <header className="space-y-1 border-b border-border px-6 py-4">
        <nav className="flex gap-3 text-xs text-muted-foreground">
          <Link href="/admin/review" className="underline underline-offset-4">
            Reviews
          </Link>
          {matterId ? (
            <Link href={`/admin/matters/${matterId}?tab=reviews`} className="underline underline-offset-4">
              Matter
            </Link>
          ) : null}
        </nav>
        <h1 className="text-lg font-semibold tracking-tight">
          {run.promptSlug ? `${run.promptSlug} v${run.promptVersionNumber}` : `${run.kind} run`}
        </h1>
        {run.reviewUploadId ? (
          <p className="text-sm" data-testid="unfiled-document">
            {run.documentLabel ?? 'Uploaded document'}{' '}
            <span className="text-xs text-muted-foreground">
              · {run.uploadFromWord ? 'from Word' : 'upload'}
              {run.uploadMatterTitle ? `, linked to ${run.uploadMatterTitle}` : ', not filed on a matter'}
            </span>
          </p>
        ) : run.documentLabel ? (
          <p className="text-sm">{run.documentLabel}</p>
        ) : null}
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
      </header>
      <StoredFindings runId={run.runId} findings={run.findings} layer={run.layer} steps={run.steps} />
    </div>
  )
}
