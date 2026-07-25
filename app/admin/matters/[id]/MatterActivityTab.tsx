'use client'

import Link from 'next/link'
import { formatDateTime } from '@/lib/utils'
import type { MatterActivity } from '@/types/database'

interface DocumentReference {
  id: string
  name: string
}

interface ActivityDay {
  key: string
  label: string
  events: MatterActivity[]
}

const ACTIVITY_EVENT_LABELS: Partial<Record<MatterActivity['event_type'], string>> = {
  intake_sent: 'Intake sent',
  intake_completed: 'Intake completed',
  draft_generated: 'Drafts generated',
  stage_changed: 'Stage changed',
}

export function groupActivityByDay(activity: MatterActivity[]): ActivityDay[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const groups = new Map<string, MatterActivity[]>()
  for (const event of activity) {
    const date = new Date(event.created_at)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  return [...groups.entries()].map(([key, events]) => ({
    key,
    label: formatter.format(new Date(events[0].created_at)),
    events,
  }))
}

function actorInitials(name: string | null | undefined): string {
  if (!name?.trim()) return 'CS'
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
}

function documentReferences(metadata: MatterActivity['metadata']): DocumentReference[] {
  if (!metadata || !Array.isArray(metadata.documentRefs)) return []
  return metadata.documentRefs.filter(
    (value): value is DocumentReference =>
      typeof value === 'object'
      && value !== null
      && typeof (value as Record<string, unknown>).id === 'string'
      && typeof (value as Record<string, unknown>).name === 'string',
  )
}

function legacyDocumentNames(metadata: MatterActivity['metadata']): string[] {
  return metadata && Array.isArray(metadata.documents)
    ? metadata.documents.filter((value): value is string => typeof value === 'string')
    : []
}

export function MatterActivityTab({ activity, loading }: { activity: MatterActivity[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading activity…</p>
  if (activity.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <p className="text-sm font-medium">No activity yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Stage changes, intake, comms, and drafting events appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {groupActivityByDay(activity).map(day => (
        <section key={day.key} aria-labelledby={`activity-day-${day.key}`}>
          <h3 id={`activity-day-${day.key}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {day.label}
          </h3>
          <div className="relative space-y-4">
            <div className="absolute bottom-3 left-[15px] top-3 w-px bg-border" aria-hidden />
            {day.events.map(item => {
              const refs = item.event_type === 'draft_generated' ? documentReferences(item.metadata) : []
              const legacyNames = item.event_type === 'draft_generated' ? legacyDocumentNames(item.metadata) : []
              const draftCount = refs.length || legacyNames.length
              return (
                <article key={item.id} className="relative flex gap-3">
                  <div
                    className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-[10px] font-semibold"
                    aria-label={item.actor_name ? `Actor: ${item.actor_name}` : 'Cornerstone system'}
                  >
                    {actorInitials(item.actor_name)}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="text-sm font-medium">
                      {item.event_type === 'draft_generated' && draftCount > 0
                        ? `Generated ${draftCount} drafts`
                        : item.title || ACTIVITY_EVENT_LABELS[item.event_type] || 'Matter updated'}
                    </p>
                    {item.metadata?.origin === 'lead' && (
                      <span className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
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
                                className="text-accent hover:underline"
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
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDateTime(item.created_at)}
                      {item.actor_name ? ` · ${item.actor_name}` : ''}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
