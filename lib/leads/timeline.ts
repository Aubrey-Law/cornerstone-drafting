export type LeadTimelineCall = {
  id: string
  direction: 'inbound' | 'outbound'
  status: string
  participant_number: string
  started_at: string
  duration_seconds: number | null
  recording_url: string | null
  voicemail_url: string | null
  summary: string | null
  firm_user_email: string | null
}

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
  calls: LeadTimelineCall[]
  activity: LeadTimelineActivity[]
  actorNames: Record<string, string>
}

export type LeadTimelineItem = {
  id: string
  kind: 'note' | 'meeting' | 'call' | 'system'
  title: string
  body: string | null
  actorId: string | null
  actorName: string
  occurredAt: string
  editableNoteId?: string
  call?: LeadTimelineCall
}

export type LeadTimelineFilter = 'all' | 'notes' | 'calls' | 'system'

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

function durationLabel(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function callBody(call: LeadTimelineCall): string {
  const metadata = `${call.direction} · ${call.status} · ${durationLabel(call.duration_seconds)}`
  return [call.participant_number, metadata, call.summary].filter(Boolean).join('\n')
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
  const callItems: LeadTimelineItem[] = sources.calls.map(call => ({
    id: `call:${call.id}`,
    kind: 'call',
    title: `${call.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`,
    body: callBody(call),
    actorId: null,
    actorName: call.firm_user_email ?? 'System',
    occurredAt: call.started_at,
    call,
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

  return [...noteLikeItems, ...callItems, ...systemItems]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
}

export function filterLeadTimeline(
  items: LeadTimelineItem[],
  filter: LeadTimelineFilter,
): LeadTimelineItem[] {
  if (filter === 'all') return items
  if (filter === 'notes') return items.filter(item => item.kind === 'note' || item.kind === 'meeting')
  if (filter === 'calls') return items.filter(item => item.kind === 'call')
  return items.filter(item => item.kind === 'system')
}
