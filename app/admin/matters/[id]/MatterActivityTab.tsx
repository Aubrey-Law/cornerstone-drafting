'use client'

import Link from 'next/link'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { cn, FIRM_TIMEZONE } from '@/lib/utils'
import { firmDateKey } from '@/lib/firmDate'
import { completeActivity } from '@/lib/matters/activityPage'
import type { MatterActivity } from '@/types/database'
import {
  activityEventTitle,
  documentReferences,
  draftDocumentCount,
  eventMetaFor,
  legacyDocumentNames,
} from './activityEventMeta'

interface ActivityDay {
  key: string
  label: string
  events: MatterActivity[]
}

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: FIRM_TIMEZONE })

/**
 * Days in the firm's calendar, the same zone each row's time is shown in.
 * Grouping by the viewer's zone (or the server's UTC on first render) put a
 * late-evening event under the next day.
 */
export function groupActivityByDay(activity: MatterActivity[]): ActivityDay[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: FIRM_TIMEZONE,
  })
  const groups = new Map<string, MatterActivity[]>()
  for (const event of activity) {
    const key = firmDateKey(event.created_at) ?? 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  return [...groups.entries()].map(([key, events]) => ({
    key,
    label: formatter.format(new Date(events[0].created_at)),
    events,
  }))
}

export function MatterActivityTab({
  activity,
  loading,
  olderCursor = null,
  loadingOlder = false,
  onLoadOlder,
}: {
  activity: MatterActivity[]
  loading: boolean
  /** Set while older matter activity is still to load; the list stops at it. */
  olderCursor?: string | null
  loadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading activity…</p>
  if (activity.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={History}
          title="No activity yet"
          description="Stage changes, intake, communications, and drafting events appear here."
        />
      </Card>
    )
  }

  const shown = completeActivity(activity, olderCursor)

  return (
    <div className="space-y-7">
      {groupActivityByDay(shown).map(day => (
        <section key={day.key} aria-labelledby={`activity-day-${day.key}`}>
          <h3 id={`activity-day-${day.key}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {day.label}
          </h3>
          <div className="relative space-y-4">
            <div className="absolute bottom-3 left-[15px] top-3 w-px bg-border" aria-hidden />
            {day.events.map(item => {
              const meta = eventMetaFor(item.event_type)
              const EventIcon = meta.icon
              const refs = item.event_type === 'draft_generated' ? documentReferences(item.metadata) : []
              const legacyNames = item.event_type === 'draft_generated' ? legacyDocumentNames(item.metadata) : []
              const draftCount = draftDocumentCount(item)
              return (
                <article key={item.id} className="relative flex gap-3">
                  <div
                    className={cn(
                      'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      meta.color,
                    )}
                    role="img"
                    aria-label={meta.label}
                  >
                    <EventIcon className="h-3.5 w-3.5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="text-sm font-medium">{activityEventTitle(item)}</p>
                    {item.metadata?.origin === 'lead' && (
                      <span className="inline-flex rounded-full border px-2 py-0.5 text-micro font-semibold text-muted-foreground">
                        From lead
                      </span>
                    )}
                    {item.detail && <p className="max-w-[70ch] text-xs text-muted-foreground">{item.detail}</p>}
                    {item.event_type === 'draft_generated' && draftCount > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Show drafts</summary>
                        <ul className="mt-1 space-y-1 pl-3">
                          {refs.map(reference => (
                            <li key={reference.id}>
                              <Link
                                className="text-primary hover:underline"
                                href={`?tab=documents&document=${encodeURIComponent(reference.id)}`}
                              >
                                {reference.name}
                              </Link>
                            </li>
                          ))}
                          {refs.length === 0 && legacyNames.map(name => <li key={name}>{name}</li>)}
                        </ul>
                      </details>
                    )}
                    {/* The day is the section heading; the row needs only the time. */}
                    <p className="mt-1 text-micro text-muted-foreground">
                      <time dateTime={item.created_at}>{TIME.format(new Date(item.created_at))}</time>
                      {item.actor_name ? ` · ${item.actor_name}` : ''}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}
      {olderCursor && onLoadOlder ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading…' : 'Show older activity'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
