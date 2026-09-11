'use client'
import { Button } from '@/components/ui/button'
import type { DraftRun } from '@/lib/drafting/runState'
export type VisibleDraftRun = Omit<DraftRun, 'worker_token' | 'request_hash'> & { retryable: boolean }
export function DraftRunStatus({ run, busy, onRetry, onReview }: { run: VisibleDraftRun; busy: boolean; onRetry: () => void; onReview: () => void }) {
  const saved = run.outcomes.filter(o => o.status === 'saved')
  const outstanding = run.requested_documents.length - saved.length
  return <section className="rounded-lg border bg-card p-4" aria-label="Latest draft run">
    <div role="status" aria-live="polite">
      <h3 className="text-sm font-semibold">{run.status === 'completed' ? 'Drafts saved' : run.status === 'running' && !run.retryable ? 'Preparing drafts…' : 'Draft run needs attention'}</h3>
      <p className="mt-1 text-sm">{saved.length} of {run.requested_documents.length} documents saved{outstanding > 0 ? ` · ${outstanding} remaining` : ''}</p>
    </div>
    {run.error && <p className="mt-2 text-sm text-destructive">{run.error}</p>}
    <ul className="my-3 space-y-1 text-xs">
      {run.outcomes.map(o => <li key={o.filename}>{o.name} — {o.status === 'saved' ? 'Saved' : `Not saved: ${o.error ?? 'Try again'}`}{(o.markerCount ?? 0) > 0 ? ` · ${o.markerCount} unresolved markers` : ''}</li>)}
    </ul>
    <div className="flex flex-wrap gap-2">
      {run.retryable && outstanding > 0 && <Button size="sm" disabled={busy} onClick={onRetry}>Retry {outstanding} remaining document{outstanding === 1 ? '' : 's'}</Button>}
      {saved.length > 0 && <Button size="sm" variant="outline" onClick={onReview}>Review saved drafts</Button>}
    </div>
  </section>
}
