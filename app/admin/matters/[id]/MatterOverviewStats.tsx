'use client'

import { AlarmClock, CalendarClock, FileText, ListTodo, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { matterDeadlineTone } from '@/lib/matters/cardFacts'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import type { RecordTaskCounts } from '@/lib/tasks/types'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'

/**
 * The four numbers worth knowing about a matter before reading anything else.
 *
 * Each is a control rather than a readout — a count that says something needs
 * attention and then leaves you to find it is only half a signal. Every tile
 * opens the tab that holds what it counted.
 *
 * The grid uses container queries, not viewport breakpoints: this sits beside a
 * 352px facts rail, so how much room it actually has is a question about its
 * container and not about the window.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

function StatTile({
  icon: Icon,
  label,
  value,
  sublabel,
  valueClassName,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  sublabel?: string
  valueClassName?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-4 py-3 text-start transition-colors hover:bg-muted/50"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {/*
        Deliberately smaller than a dashboard KPI. This sits above the matter's
        actual content and should not outshout it.
      */}
      <span className={cn('text-xl font-semibold tabular-nums', valueClassName)}>{value}</span>
      {sublabel && (
        <span className="truncate text-xs text-muted-foreground">{sublabel}</span>
      )}
    </button>
  )
}

interface MatterOverviewStatsProps {
  taskCounts: RecordTaskCounts
  uploads: UnreviewedUploadCounts
  aging: MatterAgingSummary | null
  /** Signing date, if one is set. */
  signingDate: string | null
  nextAppointment: string | null
  onOpenTasks: () => void
  onOpenDocuments: () => void
}

export function MatterOverviewStats({
  taskCounts,
  uploads,
  aging,
  signingDate,
  nextAppointment,
  onOpenTasks,
  onOpenDocuments,
}: MatterOverviewStatsProps) {
  // Whichever comes first: the signing is the milestone, but a meeting before it
  // is the thing actually in the way.
  const upcoming = [signingDate, nextAppointment]
    .filter((value): value is string => Boolean(value))
    .map(value => ({ value, at: Date.parse(value) }))
    .filter(entry => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at)[0]

  const upcomingIsSigning = upcoming?.value === signingDate

  return (
    <div className="@container">
      <div className="grid gap-3 @sm:grid-cols-2 @3xl:grid-cols-4">
        <StatTile
          icon={ListTodo}
          label="Open tasks"
          value={String(taskCounts.open)}
          sublabel={taskCounts.overdue > 0 ? `${taskCounts.overdue} overdue` : undefined}
          valueClassName={taskCounts.overdue > 0 ? 'text-red' : undefined}
          onClick={onOpenTasks}
        />
        <StatTile
          icon={FileText}
          label="To review"
          value={String(uploads.total)}
          sublabel={uploads.total > 0 ? 'Uploads nobody has read' : 'Nothing waiting'}
          onClick={onOpenDocuments}
        />
        <StatTile
          icon={AlarmClock}
          label="Days in stage"
          value={aging?.daysInStage != null ? String(aging.daysInStage) : '—'}
          sublabel={aging?.slaDays != null ? `Target ${aging.slaDays}` : undefined}
          valueClassName={
            aging?.health === 'red'
              ? 'text-red'
              : aging?.health === 'amber'
                ? 'text-amber'
                : undefined
          }
          onClick={onOpenTasks}
        />
        <StatTile
          icon={CalendarClock}
          label="Next date"
          value={upcoming ? DATE.format(upcoming.at) : '—'}
          sublabel={upcoming ? (upcomingIsSigning ? 'Signing' : 'Appointment') : 'None scheduled'}
          valueClassName={upcoming ? matterDeadlineTone(upcoming.at) : undefined}
          onClick={onOpenTasks}
        />
      </div>
    </div>
  )
}
