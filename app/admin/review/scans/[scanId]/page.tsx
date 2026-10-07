import { MatterWorkspaceShell } from '@/components/matter/MatterWorkspaceShell'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { notFound } from 'next/navigation'
import { loadReviewRunIdForUpload, loadScan, SCAN_LABEL, scanStatusLabel, type Importance } from '@/lib/review/scans'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { ScanItemsList } from './ScanItemsList'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Word check' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One saved issue-spotting or proofreading pass from the Word add-in: every
 * item, most important first, with the passage it quotes and the attorney's
 * decision on it.
 */
export default async function SavedScanPage({ params }: { params: Promise<{ scanId: string }> }) {
  await requireStaffPage()

  const { scanId } = await params
  if (!UUID.test(scanId)) notFound()
  const client = reviewClient()
  const scan = await loadScan(client, scanId)
  if (!scan) notFound()

  // The review this ran with, when one saved the same copy of the document.
  const reviewRunId = await loadReviewRunIdForUpload(client, scan.reviewUploadId)
  const counts = { important: 0, notable: 0, minor: 0 } satisfies Record<Importance, number>
  for (const item of scan.items) counts[item.importance] += 1

  return (
    <div className="space-y-4">
      {scan.matterId && <MatterWorkspaceShell matterId={scan.matterId} active="reviews" />}
      <PageHeader
        eyebrow="From Word"
        title={SCAN_LABEL[scan.kind]}
        description={scan.documentName}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/review">
                <ArrowLeft className="size-4" aria-hidden />
                All reviews
              </Link>
            </Button>
            {reviewRunId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/review/${reviewRunId}`}>The review it ran with</Link>
              </Button>
            ) : null}
            {scan.matterId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/matters/${scan.matterId}?tab=reviews`}>Open matter</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground" data-testid="scan-counts">
          {counts.important} important · {counts.notable} notable · {counts.minor} minor · {scanStatusLabel(scan)} ·{' '}
          {scan.startedAt.slice(0, 10)}
        </p>
        {/* A section never checked is not a section with nothing wrong, so it is named. */}
        {scan.failures.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Not checked: {scan.failures.map(f => `section ${f.section} (${f.reason})`).join(', ')}
          </p>
        ) : null}
      </div>

      <Card className="gap-0 py-0">
        {scan.items.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            {scan.status === 'completed' ? 'Nothing found.' : 'No items were saved.'}
          </p>
        ) : (
          <ScanItemsList scanId={scan.scanId} items={scan.items} />
        )}
      </Card>
    </div>
  )
}
