'use client'

import { useState } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, CircleDot, FilePenLine, MessageSquareText, RefreshCw } from 'lucide-react'

type ActivityRow = {
  id: string
  event_type?: string | null
  title: string
  detail?: string | null
  created_at: string
}

const PREVIEW_COUNT = 8

function activityIcon(type: string | null | undefined) {
  if (type?.includes('meeting')) return CalendarDays
  if (type?.includes('note')) return MessageSquareText
  if (type?.includes('status') || type?.includes('converted')) return RefreshCw
  if (type?.includes('agreement') || type?.includes('details')) return FilePenLine
  return CircleDot
}

function activityTime(value: string) {
  const date = new Date(value)
  const elapsed = Date.now() - date.getTime()
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export function LeadActivityCard({ activity }: { activity: ActivityRow[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? activity : activity.slice(0, PREVIEW_COUNT)
  const hidden = Math.max(0, activity.length - PREVIEW_COUNT)

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Activity</h2>
          <p className="text-[11px] text-muted-foreground">A single history of lead changes, notes, and meetings.</p>
        </div>
        {activity.length > 0 && <span className="text-xs text-muted-foreground">{activity.length} event{activity.length === 1 ? '' : 's'}</span>}
      </div>
      <div className="mt-5 space-y-0">
        {visible.map((row, index) => {
          const Icon = activityIcon(row.event_type)
          return (
            <article key={row.id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < visible.length - 1 && <span aria-hidden className="absolute left-3 top-7 h-[calc(100%-1.25rem)] w-px bg-border" />}
              <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-medium">{row.title}</p>
                  <time className="text-xs text-muted-foreground" dateTime={row.created_at}>{activityTime(row.created_at)}</time>
                </div>
                {row.detail && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{row.detail}</p>}
              </div>
            </article>
          )
        })}
        {activity.length === 0 && <p className="py-4 text-sm text-muted-foreground">No activity yet.</p>}
      </div>
      {(hidden > 0 || expanded) && (
        <button type="button" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setExpanded(value => !value)}>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? 'Show recent activity' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  )
}
