import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadReviewRunIdForUpload, loadScan, SCAN_LABEL, scanStatusLabel, type Importance } from '@/lib/review/scans'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { ScanItemsList } from './ScanItemsList'

export const dynamic = 'force-dynamic'

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
    <div className="flex flex-col">
      <header className="space-y-1 border-b border-border px-6 py-4">
        <nav className="flex gap-3 text-xs text-muted-foreground">
          <Link href="/admin/review" className="underline underline-offset-4">
            Reviews
          </Link>
          {reviewRunId ? (
            <Link href={`/admin/review/${reviewRunId}`} className="underline underline-offset-4">
              The review it ran with
            </Link>
          ) : null}
          {scan.matterId ? (
            <Link href={`/admin/matters/${scan.matterId}?tab=reviews`} className="underline underline-offset-4">
              Matter
            </Link>
          ) : null}
        </nav>
        <h1 className="text-lg font-semibold tracking-tight">{SCAN_LABEL[scan.kind]}</h1>
        <p className="text-sm">
          {scan.documentName} <span className="text-xs text-muted-foreground">· from Word</span>
        </p>
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
      </header>

      {scan.items.length === 0 ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">
          {scan.status === 'completed' ? 'Nothing found.' : 'No items were saved.'}
        </p>
      ) : (
        <ScanItemsList scanId={scan.scanId} items={scan.items} />
      )}
    </div>
  )
}
