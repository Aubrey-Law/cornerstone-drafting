'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { RunSummary } from '@/lib/review/history'
import { RunHistoryList } from '@/app/admin/review/components/RunHistoryList'
import { CARD_ACTION_STACKED, MatterFieldAuditsCard } from './MatterFieldAuditsCard'

/**
 * The matter's Reviews tab: the checks run on its work. Playbook reviews of
 * its filed documents, of prior plans linked to it, and of drafts reviewed
 * from the Word add-in; and field audits of its design sheet. Loaded when the
 * tab is opened, like the other tabs' data.
 */
export function MatterReviewsTab({ matterId }: { matterId: string }) {
  return (
    <div className="space-y-4">
      <MatterPlaybookReviewsCard matterId={matterId} />
      <MatterFieldAuditsCard matterId={matterId} />
    </div>
  )
}

function MatterPlaybookReviewsCard({ matterId }: { matterId: string }) {
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
        <CardTitle className="text-sm">Playbook reviews</CardTitle>
        <CardDescription className="col-start-1 text-xs">
          Playbook reviews of this matter&apos;s documents, its prior plans, and drafts reviewed from Word.
        </CardDescription>
        <CardAction className={CARD_ACTION_STACKED}>
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
        <EmptyState
          icon={FileSearch}
          className="py-6"
          title="No reviews yet"
          description="Review one of this matter's documents, or run one from the Review tab in Word with this matter linked."
        />
      ) : (
        <RunHistoryList runs={runs} showMatter={false} />
      )}
    </Card>
  )
}
