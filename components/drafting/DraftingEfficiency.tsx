'use client'
import { formatElapsed, type DraftingMetrics } from '@/lib/drafting/metrics'
export function DraftingEfficiency({ metrics }: { metrics: DraftingMetrics }) {
  return <details className="rounded-lg border bg-card p-4 text-sm">
    <summary className="cursor-pointer font-medium">Drafting activity · past 30 days</summary>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Completed draft runs</dt><dd>{metrics.completed} of {metrics.runs}</dd></div>
      <div><dt className="text-muted-foreground">Runs needing attention</dt><dd>{metrics.needsAttention}</dd></div>
      <div><dt className="text-muted-foreground">Average run elapsed time</dt><dd>{formatElapsed(metrics.averageRunSeconds)}</dd></div>
      <div><dt className="text-muted-foreground">Average time to recorded review</dt><dd>{formatElapsed(metrics.averageReviewSeconds)} · {metrics.reviewedDocuments} documents</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted-foreground">This matter only. Elapsed times include time between attempts or before review; they do not measure active working time.</p>
  </details>
}
