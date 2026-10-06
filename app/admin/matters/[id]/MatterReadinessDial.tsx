'use client'

import { cn } from '@/lib/utils'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'

export interface MatterReadinessItem {
  key: string
  label: string
  resolved: boolean
}

/**
 * Turns the readiness signals the matter page already computes into the flat
 * required-item list the dial scores. Nothing here reads a new data source —
 * every input is a prop `MatterDetailClient` already holds.
 */
export function buildMatterReadinessItems({
  reviewFlags,
  unreviewedUploadCounts,
  unreadPortalCount,
  milestones,
}: {
  reviewFlags: IntakeReadinessFlag[]
  unreviewedUploadCounts: UnreviewedUploadCounts
  unreadPortalCount: number
  milestones: Array<{ key: string; label: string; resolved: boolean }>
}): MatterReadinessItem[] {
  return [
    ...milestones,
    ...reviewFlags.map(flag => ({ key: `flag:${flag.key}`, label: flag.label, resolved: false })),
    {
      key: 'uploads',
      label: 'Uploads reviewed',
      resolved: unreviewedUploadCounts.total === 0,
    },
    {
      key: 'portal',
      label: 'Client messages read',
      resolved: unreadPortalCount === 0,
    },
  ]
}

export function MatterReadinessDial({
  items,
  className,
}: {
  items: MatterReadinessItem[]
  className?: string
}) {
  const blockers = items.filter(item => !item.resolved)
  const blocked = blockers.length > 0
  const percent = items.length === 0
    ? 100
    : Math.round(((items.length - blockers.length) / items.length) * 100)

  const ring = blocked ? 'var(--amber)' : 'var(--green)'
  // The labels name the goal ("Intake complete"), so a bare list read as if
  // those things were done; say they are still needed.
  const subtitle = blocked
    ? `Still needed: ${blockers.slice(0, 3).map(item => item.label).join(' · ')}${blockers.length > 3 ? ` · +${blockers.length - 3} more` : ''}`
    : 'No open blockers'

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
        aria-label={`Drafting readiness ${percent} percent`}
        className="relative size-11 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${ring} ${percent}%, var(--border) 0)` }}
      >
        <span
          className={cn(
            'absolute inset-[3px] flex items-center justify-center rounded-full text-micro font-semibold tabular-nums',
            blocked ? 'bg-amber-bg text-amber' : 'bg-card text-green',
          )}
        >
          {percent}%
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold">Drafting readiness</p>
        <p className="line-clamp-2 text-micro text-muted-foreground" title={subtitle}>
          {subtitle}
        </p>
      </div>
    </div>
  )
}
