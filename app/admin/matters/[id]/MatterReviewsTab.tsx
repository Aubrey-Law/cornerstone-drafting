'use client'

import { useEffect, useState } from 'react'
import type { RunSummary } from '@/lib/review/history'
import { RunHistoryList } from '@/app/admin/review/components/RunHistoryList'

/**
 * The matter's recorded playbook reviews: of its filed documents, of prior
 * plans linked to it, and those run from the Word add-in against its drafts.
 * Loaded when the tab is opened, like the other tabs' data.
 */
export function MatterReviewsTab({ matterId }: { matterId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setRuns(null)
    setError(null)
    fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/reviews`)
      .then(async response => {
        const body = (await response.json().catch(() => ({}))) as { reviews?: RunSummary[]; error?: string }
        if (!response.ok) throw new Error(body.error ?? `Could not load reviews (${response.status})`)
        if (current) setRuns(body.reviews ?? [])
      })
      .catch(err => {
        if (current) setError(err instanceof Error ? err.message : 'Could not load reviews')
      })
    return () => {
      current = false
    }
  }, [matterId])

  return (
    <section className="rounded-lg border border-border bg-card" data-testid="matter-reviews">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Reviews</h3>
        <p className="text-xs text-muted-foreground">
          Playbook reviews of this matter&apos;s documents, its prior plans, and drafts reviewed from Word.
        </p>
      </div>
      <div className="px-4 py-2">
        {error ? (
          <p className="py-3 text-sm text-destructive">{error}</p>
        ) : runs === null ? (
          <p className="py-3 text-sm text-muted-foreground">Loading reviews…</p>
        ) : runs.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            No reviews yet. Run one from the Review tab in Word with this matter linked.
          </p>
        ) : (
          <RunHistoryList runs={runs} showMatter={false} />
        )}
      </div>
    </section>
  )
}
