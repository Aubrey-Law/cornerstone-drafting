'use client'

import Link from 'next/link'
import { ArrowRight, Clock, TriangleAlert as AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MatterNextAction } from '@/lib/matterNextAction'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import { formatUnreviewedUploadDetail, formatUnreviewedUploadLabel } from '@/lib/matter/unreviewedUploads'
import { STAGES, type MatterStage, type PipelineMatter } from '@/types/database'

interface MatterOverviewHeroProps {
  matter: PipelineMatter
  stageSaving: boolean
  onStageChange: (stage: MatterStage) => void
  daysOpen: number
  agingHealth: 'red' | 'amber' | 'green' | null
  nextAction: MatterNextAction
  unreadPortalCount: number
  unreviewedUploadCounts?: UnreviewedUploadCounts
  reviewFlagsCount: number
  lastPortalMessage: { body: string; created_at: string; sender_role: string } | null
  quickPrompts?: React.ReactNode
  onIntakeActionClick?: () => void
  onEngagementActionClick?: () => void
  onUnreadClick?: () => void
  onReviewFlagsClick?: () => void
  onReviewUploads?: () => void
}

function isMarried(maritalStatus: string | null | undefined): boolean {
  return maritalStatus?.trim().toLowerCase() === 'married'
}

function ContactLine({ label, name, email, phone }: { label: string; name: string | null; email: string | null; phone: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{name || `${label} —`}</span>
      {email && <> · {email}</>}
      {phone && <> · {phone}</>}
    </p>
  )
}

const AGING_BADGE: Record<'red' | 'amber' | 'green', string> = {
  red: 'border-red-strong-border bg-red-strong-bg text-red-strong',
  amber: 'border-amber-border bg-amber-bg text-amber',
  green: 'border-green/40 bg-green-bg text-green',
}

export function MatterOverviewHero({
  matter,
  stageSaving,
  onStageChange,
  daysOpen,
  agingHealth,
  nextAction,
  unreadPortalCount,
  unreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  reviewFlagsCount,
  lastPortalMessage,
  quickPrompts,
  onIntakeActionClick,
  onEngagementActionClick,
  onUnreadClick,
  onReviewFlagsClick,
  onReviewUploads,
}: MatterOverviewHeroProps) {
  const isIntakeAction = nextAction.kind === 'send-intake' || nextAction.kind === 'waiting-intake'
  const isEngagementAction = nextAction.kind === 'send-engagement' || nextAction.kind === 'waiting-engagement'
  const uploadLabel = formatUnreviewedUploadLabel(unreviewedUploadCounts)
  const uploadDetail = formatUnreviewedUploadDetail(unreviewedUploadCounts)
  const showSpouse = isMarried(matter.marital_status)

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-green/40 bg-green-bg text-[10px] text-green">
              Matter Status: Hired
            </Badge>
            <Select
              value={matter.stage}
              onValueChange={v => onStageChange(v as MatterStage)}
              disabled={stageSaving}
            >
              <SelectTrigger size="sm" className="h-7 w-auto gap-1.5 text-xs" aria-label="Matter stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map(s => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {daysOpen} day{daysOpen === 1 ? '' : 's'} open
            </span>
            <span
              className="text-[11px] capitalize text-muted-foreground"
              title={matter.intake_sent_at ? `Intake sent ${new Date(matter.intake_sent_at).toLocaleString()}` : undefined}
            >
              Intake {matter.intake_status?.replace(/_/g, ' ') || '—'}
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
                  className="cursor-pointer border-amber-border bg-amber-bg text-[10px] text-amber hover:bg-amber-bg/80"
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
            <h2 className="text-sm font-semibold text-foreground">{nextAction.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{nextAction.detail}</p>
          </div>
          <div className="space-y-0.5">
            <ContactLine
              label="Client"
              name={matter.client_name}
              email={matter.client_email}
              phone={matter.client_phone}
            />
            {showSpouse && (
              <ContactLine
                label="Spouse"
                name={matter.spouse_name}
                email={matter.spouse_email}
                phone={matter.spouse_phone}
              />
            )}
          </div>
          {lastPortalMessage && (
            <p className="text-xs text-muted-foreground">
              Latest portal message ({lastPortalMessage.sender_role}):{' '}
              <span className="text-foreground">{lastPortalMessage.body.slice(0, 120)}{lastPortalMessage.body.length > 120 ? '…' : ''}</span>
            </p>
          )}
          {quickPrompts && <div className="mt-1">{quickPrompts}</div>}
        </div>
        <div className="shrink-0">
          {isIntakeAction || isEngagementAction ? (
            <Button
              type="button"
              size="sm"
              variant={nextAction.tone === 'warning' ? 'default' : 'outline'}
              onClick={isEngagementAction ? onEngagementActionClick : onIntakeActionClick}
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
