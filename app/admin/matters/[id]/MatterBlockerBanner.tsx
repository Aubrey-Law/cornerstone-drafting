'use client'

import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  resolveIntakeReviewTarget,
  type IntakeReadinessFlag,
  type IntakeReadinessResolutionKind,
} from '@/lib/intakeReadiness'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'

interface MatterBlockerBannerProps {
  matterId: string
  reviewFlags: IntakeReadinessFlag[]
  unreviewedUploadCounts: UnreviewedUploadCounts
  unreadPortalCount: number
  /** Existing drafting link — the "draft anyway" escape hatch. */
  draftingHref: string
}

function flagKind(flag: IntakeReadinessFlag): IntakeReadinessResolutionKind {
  return flag.resolutionKind
    ?? (flag.message.includes('discuss this with the attorney') ? 'attorney_judgment' : 'needs_data')
}

/**
 * Returns null when nothing is blocking — the caller then shows the aging
 * health badge in the record header instead.
 */
export function MatterBlockerBanner({
  matterId,
  reviewFlags,
  unreviewedUploadCounts,
  unreadPortalCount,
  draftingHref,
}: MatterBlockerBannerProps) {
  const needsData = reviewFlags.filter(flag => flagKind(flag) === 'needs_data')
  const attorneyJudgment = reviewFlags.filter(flag => flagKind(flag) === 'attorney_judgment')
  const uploadCount = unreviewedUploadCounts.total
  const total = reviewFlags.length + uploadCount + unreadPortalCount

  if (total === 0) return null

  const summary: string[] = []
  if (needsData.length > 0) summary.push(`Needs data: ${needsData.map(flag => flag.label).join(', ')}`)
  if (attorneyJudgment.length > 0) {
    summary.push(`Attorney judgment: ${attorneyJudgment.map(flag => flag.label).join(', ')}`)
  }
  if (uploadCount > 0) summary.push(`${uploadCount} unreviewed upload${uploadCount === 1 ? '' : 's'}`)
  if (unreadPortalCount > 0) {
    summary.push(`${unreadPortalCount} unread message${unreadPortalCount === 1 ? '' : 's'}`)
  }

  const firstFlag = reviewFlags[0]
  const resolveHref = firstFlag ? resolveIntakeReviewTarget(firstFlag).href(matterId) : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-border bg-amber-bg px-4 py-2 text-amber">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 text-xs">
        <span className="font-semibold">
          Drafting is blocked on {total} item{total === 1 ? '' : 's'}
        </span>
        <span className="text-amber/80"> — {summary.join(' · ')}</span>
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {resolveHref && (
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href={resolveHref}>Resolve blockers</Link>
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" asChild>
          <Link href={draftingHref}>Draft anyway</Link>
        </Button>
      </div>
    </div>
  )
}
