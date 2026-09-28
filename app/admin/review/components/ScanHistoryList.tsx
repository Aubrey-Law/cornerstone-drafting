import Link from 'next/link'
import { SCAN_LABEL, scanStatusLabel, type ScanSummary } from '@/lib/review/scans'

/**
 * Saved issue-spotting and proofreading passes, newest first, each opening its
 * saved check. Shared by review history and a saved review's page.
 */
export function ScanHistoryList({ scans, showDocument = true }: { scans: ScanSummary[]; showDocument?: boolean }) {
  return (
    <ul className="divide-y divide-border border-y border-border" data-testid="scan-history">
      {scans.map(scan => (
        <li key={scan.scanId}>
          <Link
            href={`/admin/review/scans/${scan.scanId}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 py-3 text-sm hover:bg-accent"
          >
            <span className="min-w-0">
              <span className="font-medium">{SCAN_LABEL[scan.kind]}</span>
              {showDocument ? <span className="ml-2 text-xs text-muted-foreground">{scan.documentName}</span> : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {scan.itemCount} {scan.itemCount === 1 ? 'item' : 'items'} · {scanStatusLabel(scan)} · {scan.startedAt.slice(0, 10)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
