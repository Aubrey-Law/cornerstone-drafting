import Link from 'next/link'
import { formatFirmDate } from '@/lib/format'
import type { RunSummary } from '@/lib/review/history'

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The right-hand line of a review or field-audit run row. A run still going
 * says so instead of "0 findings", and the date is the firm's calendar day,
 * not the UTC one an ISO slice gives.
 */
export function runSummaryLine(
  run: Pick<RunSummary, 'findingCount' | 'failedCount' | 'status' | 'finishedAt'>,
  failedNoun: 'rule' | 'check',
): string {
  if (run.status === 'queued' || run.status === 'running') return 'In progress'
  return [
    plural(run.findingCount, 'finding'),
    run.failedCount > 0 ? `${plural(run.failedCount, failedNoun)} failed` : null,
    run.status === 'partial' ? 'partial' : null,
    run.finishedAt ? formatFirmDate(run.finishedAt) : null,
  ].filter(Boolean).join(' · ')
}

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
            <span className="text-xs text-muted-foreground">{runSummaryLine(run, 'rule')}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
