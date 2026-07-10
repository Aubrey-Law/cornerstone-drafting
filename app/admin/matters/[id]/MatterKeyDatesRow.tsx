'use client'

import { cn, formatDate } from '@/lib/utils'
import type { MatterStage } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

interface MatterKeyDatesRowProps {
  matterCreated: string | null
  intakeCompletedAt: string | null
  intakeSubmittedAt: string | null
  draftsSentAt: string | null
  signingDate: string | null
  scheduledSigningDate: string | null
  closedDate: string | null
  stage: MatterStage
  details?: MatterDetailsRow | null
}

type Milestone = {
  key: string
  label: string
  date: string | null
  complete: boolean
}

function resolveDate(...candidates: Array<string | null | undefined>): string | null {
  for (const value of candidates) {
    if (value && value.trim()) return value
  }
  return null
}

function MilestoneCell({ milestone, isLast }: { milestone: Milestone; isLast: boolean }) {
  return (
    <div className={cn('relative min-w-0 flex-1 px-2 first:pl-0 last:pr-0', !isLast && 'sm:border-r sm:border-border')}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {milestone.label}
      </p>
      <p
        className={cn(
          'mt-1 text-sm font-medium',
          milestone.complete ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {milestone.date ? formatDate(milestone.date) : '—'}
      </p>
    </div>
  )
}

export function MatterKeyDatesRow({
  matterCreated,
  intakeCompletedAt,
  intakeSubmittedAt,
  draftsSentAt,
  signingDate,
  scheduledSigningDate,
  closedDate,
  stage,
  details,
}: MatterKeyDatesRowProps) {
  const opened = resolveDate(details?.open_date, matterCreated)
  const intakeDone = resolveDate(intakeCompletedAt, intakeSubmittedAt, details?.intake_date)
  const draftsSent = resolveDate(draftsSentAt, details?.draft_sent_date)
  const signing = resolveDate(signingDate, details?.signing_date, scheduledSigningDate, details?.scheduled_signing_date)
  const closed = resolveDate(closedDate, details?.closed_date)

  const milestones: Milestone[] = [
    { key: 'opened', label: 'Opened', date: opened, complete: Boolean(opened) },
    { key: 'intake', label: 'Intake done', date: intakeDone, complete: Boolean(intakeDone) },
    { key: 'drafts', label: 'Drafts sent', date: draftsSent, complete: Boolean(draftsSent) },
    { key: 'signing', label: 'Signing', date: signing, complete: Boolean(signing) },
    {
      key: 'closed',
      label: 'Closed',
      date: closed,
      complete: stage === 'closed' || Boolean(closed),
    },
  ]

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Key dates
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-0">
        {milestones.map((milestone, index) => (
          <MilestoneCell
            key={milestone.key}
            milestone={milestone}
            isLast={index === milestones.length - 1}
          />
        ))}
      </div>
    </section>
  )
}
