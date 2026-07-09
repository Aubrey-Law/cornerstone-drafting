'use client'

import { Activity, CheckCircle2, FileText, Info, Send } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import type { ActivityEventType, MatterActivity } from '@/types/database'

const EVENT_META: Partial<Record<ActivityEventType, { icon: React.ReactNode; color: string }>> = {
  stage_changed: { icon: <Activity className="h-3.5 w-3.5" />, color: 'text-accent bg-accent/10' },
  intake_sent: { icon: <Send className="h-3.5 w-3.5" />, color: 'text-accent bg-accent/10' },
  intake_completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-success bg-success/10' },
  email_sent: { icon: <Send className="h-3.5 w-3.5" />, color: 'text-muted-foreground bg-muted' },
  draft_generated: { icon: <FileText className="h-3.5 w-3.5" />, color: 'text-accent bg-accent/10' },
  draft_promoted_to_review: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-success bg-success/10' },
  matter_created: { icon: <Info className="h-3.5 w-3.5" />, color: 'text-muted-foreground bg-muted' },
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(iso)
}

interface MatterActivityTabProps {
  activity: MatterActivity[]
  loading: boolean
}

export function MatterActivityTab({ activity, loading }: MatterActivityTabProps) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading activity…</p>
  }

  if (activity.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <p className="text-sm font-medium">No activity yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Stage changes, intake, comms, and drafting events appear here.</p>
      </div>
    )
  }

  return (
    <div className="relative space-y-3">
      <div className="absolute left-[13px] top-2 bottom-2 w-px bg-border" aria-hidden />
      {activity.map(item => {
        const meta = EVENT_META[item.event_type] ?? EVENT_META.matter_created!
        return (
          <div key={item.id} className="relative flex gap-3 pl-0">
            <div className={cn('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', meta.color)}>
              {meta.icon}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {relativeTime(item.created_at)}
                {item.actor_name ? ` · ${item.actor_name}` : ''}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
