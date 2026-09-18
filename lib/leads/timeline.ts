export type LeadTimelineNote = {
  id: string
  body: string
  actorId: string
  createdAt: string
  updatedAt: string
}

export type LeadTimelineMeeting = LeadTimelineNote & {
  title: string
  date: string
  attendees: string[]
  source: string
  granolaNoteId: string | null
}

/**
 * The rows the lead-note RPCs hand back, in the database's own snake_case.
 *
 * They sit beside the camelCase types they map to because that pairing is the
 * whole job of the `dto` helpers in the notes routes — which typed their
 * argument `any`, so a renamed column would have produced `undefined` in the
 * response rather than a type error.
 */
export type LeadNoteRow = {
  id: string
  body: string
  actor_id: string
  created_at: string
  updated_at: string
}

export type LeadMeetingNoteRow = LeadNoteRow & {
  title: string
  meeting_date: string
  attendees: string[]
  source: string
  granola_note_id: string | null
}

export type LeadTimelineActivity = {
  id: string
  event_type?: string | null
  title: string
  detail?: string | null
  actor_id?: string | null
  created_at: string
}

export type LeadTimelineSources = {
  notes: LeadTimelineNote[]
  meetings: LeadTimelineMeeting[]
  activity: LeadTimelineActivity[]
  actorNames: Record<string, string>
}

export type LeadTimelineItem = {
  id: string
  kind: 'note' | 'meeting' | 'system'
  title: string
  body: string | null
  actorId: string | null
  actorName: string
  occurredAt: string
  editableNoteId?: string
}

export type LeadTimelineFilter = 'all' | 'notes' | 'system'

const ECHO_WINDOW_MS = 5_000

export function newestTimestamp(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string =>
      Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}

function actorName(actorId: string | null | undefined, names: Record<string, string>): string {
  return actorId ? names[actorId] ?? 'System' : 'System'
}

function meetingDateLabel(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function meetingBody(meeting: LeadTimelineMeeting): string {
  const metadata = [
    `Meeting date: ${meetingDateLabel(meeting.date)}`,
    meeting.attendees.length > 0 ? `Attendees: ${meeting.attendees.join(', ')}` : null,
  ].filter(Boolean)
  return [meeting.body, ...metadata].filter(Boolean).join('\n')
}

function recognizedEchoKind(
  activity: LeadTimelineActivity,
): Extract<LeadTimelineItem['kind'], 'note' | 'meeting'> | null {
  if (activity.event_type === 'note_added') return 'note'
  if (activity.event_type === 'meeting_note_added') return 'meeting'
  return null
}

function matchesLegacyEcho(activity: LeadTimelineActivity, item: LeadTimelineItem): boolean {
  const echoKind = recognizedEchoKind(activity)
  if (!echoKind || echoKind !== item.kind) return false
  const activityTime = Date.parse(activity.created_at)
  const itemTime = Date.parse(item.occurredAt)
  return activity.actor_id === item.actorId
    && Number.isFinite(activityTime)
    && Number.isFinite(itemTime)
    && Math.abs(activityTime - itemTime) <= ECHO_WINDOW_MS
}

export function buildLeadTimeline(sources: LeadTimelineSources): LeadTimelineItem[] {
  const noteItems: LeadTimelineItem[] = sources.notes.map(note => ({
    id: `note:${note.id}`,
    kind: 'note',
    title: 'Internal note',
    body: note.body,
    actorId: note.actorId,
    actorName: actorName(note.actorId, sources.actorNames),
    occurredAt: note.createdAt,
    editableNoteId: note.id,
  }))
  const meetingItems: LeadTimelineItem[] = sources.meetings.map(meeting => ({
    id: `meeting:${meeting.id}`,
    kind: 'meeting',
    title: meeting.title,
    body: meetingBody(meeting),
    actorId: meeting.actorId,
    actorName: actorName(meeting.actorId, sources.actorNames),
    occurredAt: meeting.createdAt,
  }))
  const noteLikeItems = [...noteItems, ...meetingItems]

  // Current lead_activity rows expose no note-provenance identifier. Keep this
  // legacy match deliberately narrow until a real provenance field is added.
  const systemItems: LeadTimelineItem[] = sources.activity
    .filter(activity => !noteLikeItems.some(item => matchesLegacyEcho(activity, item)))
    .map(activity => ({
      id: `system:${activity.id}`,
      kind: 'system',
      title: activity.title,
      body: activity.detail ?? null,
      actorId: activity.actor_id ?? null,
      actorName: actorName(activity.actor_id, sources.actorNames),
      occurredAt: activity.created_at,
    }))

  return [...noteLikeItems, ...systemItems]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
}

export function filterLeadTimeline(
  items: LeadTimelineItem[],
  filter: LeadTimelineFilter,
): LeadTimelineItem[] {
  if (filter === 'all') return items
  if (filter === 'notes') return items.filter(item => item.kind === 'note' || item.kind === 'meeting')
  return items.filter(item => item.kind === 'system')
}
