'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card className="gap-0 py-0" data-testid="matter-reviews">
      <CardHeader className="border-b py-3 [.border-b]:pb-3">
        <CardTitle className="text-sm">Reviews</CardTitle>
        <CardDescription className="text-xs">
          Playbook reviews of this matter&apos;s documents, its prior plans, and drafts reviewed from Word.
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/review/new?matter=${encodeURIComponent(matterId)}`}>Review a document</Link>
          </Button>
        </CardAction>
      </CardHeader>
      {error ? (
        <p className="px-4 py-3 text-sm text-destructive">{error}</p>
      ) : runs === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Loading reviews…</p>
      ) : runs.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          No reviews yet. Review one of this matter&apos;s documents, or run one from the Review tab in Word with this
          matter linked.
        </p>
      ) : (
        <RunHistoryList runs={runs} showMatter={false} />
      )}
    </Card>
  )
}
