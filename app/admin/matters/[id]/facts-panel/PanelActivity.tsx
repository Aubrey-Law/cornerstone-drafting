'use client'

import { cn, formatDateTime } from '@/lib/utils'
import type { MatterActivity } from '@/types/database'
import { activityEventTitle, eventMetaFor } from '../activityEventMeta'

/** The five most recent events, rendered the way the Activity tab renders them. */
export function PanelActivity({
  activity,
  onOpenTab,
}: {
  activity: MatterActivity[]
  onOpenTab: () => void
}) {
  const recent = activity.slice(0, 5)
  if (recent.length === 0) {
    return <p className="px-1.5 text-[11.5px] text-muted-foreground">No activity yet.</p>
  }

  return (
    <div className="px-1.5">
      <div className="relative grid gap-3">
        <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-border" />
        {recent.map(event => {
          const meta = eventMetaFor(event.event_type)
          const EventIcon = meta.icon
          return (
            <article key={event.id} className="relative flex gap-2.5">
              <div
                role="img"
                aria-label={meta.label}
                className={cn(
                  'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full',
                  meta.color,
                )}
              >
                <EventIcon className="size-3" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium">{activityEventTitle(event)}</p>
                {event.metadata?.origin === 'lead' && (
                  <span className="inline-flex rounded-full border border-border px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                    From lead
                  </span>
                )}
                {event.detail && (
                  <p className="text-[11px] text-muted-foreground">{event.detail}</p>
                )}
                <p className="mt-px text-[11px] text-muted-foreground">
                  {formatDateTime(event.created_at)}
                  {event.actor_name ? ` · ${event.actor_name}` : ''}
                </p>
              </div>
            </article>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onOpenTab}
        className="mt-2.5 text-[11px] font-semibold text-accent hover:underline"
      >
        Open activity tab
      </button>
    </div>
  )
}
