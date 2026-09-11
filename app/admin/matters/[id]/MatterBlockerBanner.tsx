'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { resolveIntakeReviewTarget, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'

interface MatterBlockerBannerProps {
  matterId: string
  reviewFlags: IntakeReadinessFlag[]
  unreviewedUploadCounts: UnreviewedUploadCounts
  unreadPortalCount: number
  draftingHref: string
  onReviewIntakeUploads?: () => void
}

/** Review flags are advisory; unread correspondence is not a drafting gate. */
export function MatterBlockerBanner({
  matterId,
  reviewFlags,
  unreviewedUploadCounts: uploads,
  unreadPortalCount,
  draftingHref,
  onReviewIntakeUploads,
}: MatterBlockerBannerProps) {
  if (!reviewFlags.length && !uploads.total && !unreadPortalCount) return null
  return (
    <section aria-label="Matter attention items" className="space-y-2 border-b border-border bg-card px-4 py-3">
      {reviewFlags.length > 0 && (
        <div className="rounded-md border border-amber-border bg-amber-bg p-3">
          <p className="text-sm font-semibold text-amber">Review before drafting</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {(['needs_data', 'attorney_judgment'] as const).map(kind => {
              const flags = reviewFlags.filter(flag => (flag.resolutionKind ?? 'needs_data') === kind)
              return flags.length > 0 && (
                <div key={kind}>
                  <p className="text-xs font-medium">{kind === 'needs_data' ? 'Needs data' : 'Attorney judgment'}</p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {flags.map(flag => (
                      <li key={flag.key}>
                        <Link className="text-sm text-primary underline underline-offset-2" href={resolveIntakeReviewTarget(flag).href(matterId)}>
                          {flag.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {uploads.intake > 0 && (onReviewIntakeUploads ? (
          <Button size="sm" variant="outline" onClick={onReviewIntakeUploads}>
            {uploads.intake} intake upload{uploads.intake === 1 ? '' : 's'} to review
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/admin/matters/${matterId}#matter-intake-actions`}>{uploads.intake} intake uploads to review</Link>
          </Button>
        ))}
        {uploads.portal > 0 && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/admin/matters/${matterId}?tab=documents&scope=unreviewed`}>
              {uploads.portal} portal upload{uploads.portal === 1 ? '' : 's'} to review
            </Link>
          </Button>
        )}
        {unreadPortalCount > 0 && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/admin/matters/${matterId}?tab=communications&channel=portal`}>
              {unreadPortalCount} unread message{unreadPortalCount === 1 ? '' : 's'}
            </Link>
          </Button>
        )}
        {reviewFlags.length > 0 && (
          <Button size="sm" variant="ghost" asChild><Link href={draftingHref}>Open drafting</Link></Button>
        )}
      </div>
    </section>
  )
}
