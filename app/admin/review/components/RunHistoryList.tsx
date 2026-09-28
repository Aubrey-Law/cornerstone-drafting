import Link from 'next/link'
import type { RunSummary } from '@/lib/review/history'

/**
 * Recorded reviews, newest first, each opening its saved review. Shared by the
 * review history page and a matter's Reviews tab.
 */
export function RunHistoryList({ runs, showMatter = true }: { runs: RunSummary[]; showMatter?: boolean }) {
  return (
    <ul className="divide-y divide-border" data-testid="run-history">
      {runs.map(run => (
        <li key={run.runId}>
          <Link
            href={`/admin/review/${run.runId}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-accent"
          >
            <span className="min-w-0">
              <span className="font-medium">{run.documentName}</span>
              {showMatter || run.unfiled ? (
                <span className="ml-2 text-xs text-muted-foreground">{run.matterTitle}</span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {run.findingCount} findings
              {run.failedCount > 0 ? ` · ${run.failedCount} rules failed` : ''}
              {run.status === 'partial' ? ' · partial' : ''}
              {run.status === 'queued' || run.status === 'running' ? ' · in progress' : ''}
              {run.finishedAt ? ` · ${run.finishedAt.slice(0, 10)}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
