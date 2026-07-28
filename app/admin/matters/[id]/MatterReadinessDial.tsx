'use client'

import { cn } from '@/lib/utils'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { MatterDesignReadiness } from '@/lib/designSheetReadiness'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'

export interface MatterReadinessSummary {
  /** Required items already satisfied. */
  resolved: number
  /** Required items in total — the dial's denominator. */
  total: number
  /** Human labels for the open items, most structural first. */
  blockers: string[]
}

/**
 * Scores the matter the way the drafting workspace does: the design sheet's own
 * required sections, plus the three things this page tracks that the sheet
 * cannot see — open intake review flags, unreviewed uploads, unread portal mail.
 */
export function buildMatterReadinessSummary({
  designReadiness,
  reviewFlags,
  unreviewedUploadCounts,
  unreadPortalCount,
}: {
  designReadiness: MatterDesignReadiness | null
  reviewFlags: IntakeReadinessFlag[]
  unreviewedUploadCounts: UnreviewedUploadCounts
  unreadPortalCount: number
}): MatterReadinessSummary {
  const blockers: string[] = []

  // Without a sheet there are no sections to score, and clean uploads must not
  // inflate the number — nothing about this matter is ready to draft yet.
  if (!designReadiness) {
    return { resolved: 0, total: 1, blockers: ['Design sheet not started'] }
  }

  let resolved = designReadiness.completedCount
  let total = designReadiness.total
  for (const blocker of designReadiness.blockers) {
    blockers.push(`${blocker.sectionLabel}: ${blocker.label}`)
  }

  for (const flag of reviewFlags) blockers.push(flag.label)
  total += reviewFlags.length

  total += 1
  if (unreviewedUploadCounts.total === 0) resolved += 1
  else blockers.push(`${unreviewedUploadCounts.total} unreviewed upload${unreviewedUploadCounts.total === 1 ? '' : 's'}`)

  total += 1
  if (unreadPortalCount === 0) resolved += 1
  else blockers.push(`${unreadPortalCount} unread message${unreadPortalCount === 1 ? '' : 's'}`)

  return { resolved, total, blockers }
}

export function MatterReadinessDial({
  summary,
  className,
}: {
  summary: MatterReadinessSummary
  className?: string
}) {
  const blocked = summary.blockers.length > 0
  const percent = summary.total === 0
    ? 100
    : Math.round((Math.min(summary.resolved, summary.total) / summary.total) * 100)

  const ring = blocked ? 'var(--amber)' : 'var(--green)'
  const subtitle = blocked ? summary.blockers.slice(0, 3).join(' · ') : 'No open blockers'

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3',
        blocked ? 'border-amber-border bg-amber-bg' : 'border-border bg-card',
        className,
      )}
    >
      <div
        role="img"
        aria-label={`Drafting readiness ${percent} percent — ${summary.resolved} of ${summary.total} required items`}
        className="relative size-11 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${ring} ${percent}%, var(--border) 0)` }}
      >
        <span
          className={cn(
            'absolute inset-[3px] flex items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
            blocked ? 'bg-amber-bg text-amber' : 'bg-card text-green',
          )}
        >
          {percent}%
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold">Drafting readiness</p>
        <p className="truncate text-[11px] text-muted-foreground" title={summary.blockers.join(' · ') || undefined}>
          {subtitle}
          {summary.blockers.length > 3 && ` · +${summary.blockers.length - 3} more`}
        </p>
      </div>
    </div>
  )
}
