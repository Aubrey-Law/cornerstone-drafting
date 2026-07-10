'use client'

import Link from 'next/link'
import { ArrowRight, Clock, TriangleAlert as AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { MatterNextAction } from '@/lib/matterNextAction'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import { formatUnreviewedUploadDetail, formatUnreviewedUploadLabel } from '@/lib/matter/unreviewedUploads'
import { stageLabel, type MatterStage } from '@/types/database'

interface MatterOverviewHeroProps {
  stage: MatterStage
  daysOpen: number
  agingHealth: 'red' | 'amber' | 'green' | null
  nextAction: MatterNextAction
  unreadPortalCount: number
  unreviewedUploadCounts?: UnreviewedUploadCounts
  reviewFlagsCount: number
  lastPortalMessage: { body: string; created_at: string; sender_role: string } | null
  onIntakeActionClick?: () => void
  onUnreadClick?: () => void
  onReviewFlagsClick?: () => void
  onReviewUploads?: () => void
}

const AGING_BADGE: Record<'red' | 'amber' | 'green', string> = {
  red: 'border-red-strong-border bg-red-strong-bg text-red-strong',
  amber: 'border-amber-border bg-amber-bg text-amber',
  green: 'border-green/40 bg-green-bg text-green',
}

export function MatterOverviewHero({
  stage,
  daysOpen,
  agingHealth,
  nextAction,
  unreadPortalCount,
  unreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  reviewFlagsCount,
  lastPortalMessage,
  onIntakeActionClick,
  onUnreadClick,
  onReviewFlagsClick,
  onReviewUploads,
}: MatterOverviewHeroProps) {
  const isIntakeAction = nextAction.href === '#send-intake'
  const uploadLabel = formatUnreviewedUploadLabel(unreviewedUploadCounts)
  const uploadDetail = formatUnreviewedUploadDetail(unreviewedUploadCounts)

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">{stageLabel(stage)}</Badge>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {daysOpen} day{daysOpen === 1 ? '' : 's'} open
            </span>
            {agingHealth && (
              <Badge variant="outline" className={cn('text-[10px] capitalize', AGING_BADGE[agingHealth])}>
                Aging {agingHealth}
              </Badge>
            )}
            {unreadPortalCount > 0 && (
              <button type="button" onClick={onUnreadClick} className="inline-flex">
                <Badge variant="outline" className="cursor-pointer text-[10px] hover:bg-muted">
                  {unreadPortalCount} unread message{unreadPortalCount === 1 ? '' : 's'}
                </Badge>
              </button>
            )}
            {reviewFlagsCount > 0 && (
              <button type="button" onClick={onReviewFlagsClick} className="inline-flex">
                <Badge
                  variant="outline"
                  className="cursor-pointer border-amber-200 bg-amber-50 text-[10px] text-amber-800 hover:bg-amber-100"
                >
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {reviewFlagsCount} review flag{reviewFlagsCount === 1 ? '' : 's'}
                </Badge>
              </button>
            )}
            {unreviewedUploadCounts.total > 0 && (
              <Badge
                variant="outline"
                className="cursor-pointer border-amber-border bg-amber-bg text-[10px] text-amber hover:bg-amber-bg/80"
                title={uploadDetail}
                onClick={onReviewUploads}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onReviewUploads?.()
                  }
                }}
                role={onReviewUploads ? 'button' : undefined}
                tabIndex={onReviewUploads ? 0 : undefined}
              >
                {uploadLabel}
              </Badge>
            )}
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">{nextAction.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{nextAction.detail}</p>
          </div>
          {lastPortalMessage && (
            <p className="text-xs text-muted-foreground">
              Latest portal message ({lastPortalMessage.sender_role}):{' '}
              <span className="text-foreground">{lastPortalMessage.body.slice(0, 120)}{lastPortalMessage.body.length > 120 ? '…' : ''}</span>
            </p>
          )}
        </div>
        <div className="shrink-0">
          {isIntakeAction ? (
            <Button
              type="button"
              size="sm"
              variant={nextAction.tone === 'warning' ? 'default' : 'outline'}
              onClick={onIntakeActionClick}
            >
              {nextAction.cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button type="button" size="sm" asChild>
              <Link href={nextAction.href}>
                {nextAction.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
