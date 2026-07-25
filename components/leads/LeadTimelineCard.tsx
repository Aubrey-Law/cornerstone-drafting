'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { CalendarDays, CircleDot, MessageSquareText, Phone } from 'lucide-react'
import { OPEN_STAFF_SOFTPHONE_EVENT } from '@/app/admin/components/StaffSoftphone'
import { CallRow } from '@/components/calls/CallRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  buildLeadTimeline,
  filterLeadTimeline,
  type LeadTimelineActivity,
  type LeadTimelineCall,
  type LeadTimelineFilter,
  type LeadTimelineItem,
  type LeadTimelineMeeting,
  type LeadTimelineNote,
} from '@/lib/leads/timeline'
import { formatDateDetail, formatDateTime } from '@/lib/utils'

const AddMeetingNotesDialog = dynamic(
  () => import('@/components/meeting-notes/AddMeetingNotesDialog')
    .then(module => ({ default: module.AddMeetingNotesDialog })),
  { ssr: false },
)

type LeadMeetingNoteApiRow = {
  id: string
  title: string
  meeting_date?: string
  date?: string
  attendees: string[]
  body: string
  source: string
  granola_note_id?: string | null
  granolaNoteId?: string | null
  actor_id?: string
  actorId?: string
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
}

type Props = {
  leadId: string
  leadPhone?: string | null
  initialNotes: LeadTimelineNote[]
  initialMeetingNotes: LeadTimelineMeeting[]
  initialActivity?: LeadTimelineActivity[]
  initialCalls?: LeadTimelineCall[]
  actorNames?: Record<string, string>
  callsError?: string | null
  currentUser: { id: string; role: string }
  onActivityChange?: () => void | Promise<void>
}

const FILTERS: Array<{ value: LeadTimelineFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'notes', label: 'Notes' },
  { value: 'calls', label: 'Calls' },
  { value: 'system', label: 'System' },
]

function sortNotes(rows: LeadTimelineNote[]): LeadTimelineNote[] {
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

function sortMeetings(rows: LeadTimelineMeeting[]): LeadTimelineMeeting[] {
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

function mapMeetingNoteApiRow(row: LeadMeetingNoteApiRow): LeadTimelineMeeting {
  return {
    id: row.id,
    title: row.title,
    date: row.meeting_date ?? row.date ?? '',
    attendees: row.attendees,
    body: row.body,
    source: row.source,
    granolaNoteId: row.granola_note_id ?? row.granolaNoteId ?? null,
    actorId: row.actor_id ?? row.actorId ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function markerIcon(kind: LeadTimelineItem['kind']) {
  if (kind === 'note') return MessageSquareText
  if (kind === 'meeting') return CalendarDays
  if (kind === 'call') return Phone
  return CircleDot
}

export function LeadTimelineCard({
  leadId,
  leadPhone,
  initialNotes,
  initialMeetingNotes,
  initialActivity = [],
  initialCalls = [],
  actorNames = {},
  callsError = null,
  currentUser,
  onActivityChange,
}: Props) {
  const token = useAccessToken()
  const [notes, setNotes] = useState(() => sortNotes(initialNotes))
  const [meetings, setMeetings] = useState(() => sortMeetings(initialMeetingNotes))
  const [filter, setFilter] = useState<LeadTimelineFilter>('all')
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [granolaOpen, setGranolaOpen] = useState(false)
  const [meeting, setMeeting] = useState({ title: '', date: '', attendees: '', body: '' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(() => buildLeadTimeline({
    notes,
    meetings,
    calls: initialCalls,
    activity: initialActivity,
    actorNames,
  }), [notes, meetings, initialCalls, initialActivity, actorNames])
  const visibleItems = filterLeadTimeline(items, filter)

  async function call(url: string, method: string, payload?: unknown) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || 'Request failed')
    return json
  }

  async function mutate(work: () => Promise<void>) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await work()
      await onActivityChange?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed')
    } finally {
      setPending(false)
    }
  }

  async function addNote() {
    await mutate(async () => {
      const json = await call(`/api/admin/leads/${leadId}/notes`, 'POST', { body })
      setNotes(current => sortNotes([...current, json.note as LeadTimelineNote]))
      setBody('')
    })
  }

  async function saveNote(id: string) {
    await mutate(async () => {
      const json = await call(`/api/admin/leads/${leadId}/notes/${id}`, 'PATCH', { body: editBody })
      setNotes(current => sortNotes(current.map(note => note.id === id ? json.note : note)))
      setEditingNoteId(null)
    })
  }

  async function removeNote(id: string) {
    await mutate(async () => {
      await call(`/api/admin/leads/${leadId}/notes/${id}`, 'DELETE')
      setNotes(current => current.filter(note => note.id !== id))
    })
  }

  async function addMeeting() {
    await mutate(async () => {
      const json = await call(`/api/admin/leads/${leadId}/meeting-notes`, 'POST', {
        title: meeting.title,
        meetingDate: meeting.date,
        attendees: meeting.attendees.split(',').map(value => value.trim()).filter(Boolean),
        body: meeting.body,
      })
      const added = mapMeetingNoteApiRow(json.meetingNote as LeadMeetingNoteApiRow)
      setMeetings(current => sortMeetings([...current, added]))
      setMeetingOpen(false)
    })
  }

  function openSoftphone() {
    window.dispatchEvent(new Event(OPEN_STAFF_SOFTPHONE_EVENT))
  }

  function renderBody(item: LeadTimelineItem) {
    if (item.kind === 'call' && item.call) return <CallRow call={item.call} />
    if (item.kind === 'meeting') {
      const meetingNote = meetings.find(candidate => `meeting:${candidate.id}` === item.id)
      if (!meetingNote || expandedMeetingId !== meetingNote.id) return null
      return (
        <div className="mt-2 space-y-1 text-sm">
          <p className="whitespace-pre-wrap">{meetingNote.body}</p>
          <p className="text-xs text-muted-foreground">
            Meeting date: {formatDateDetail(meetingNote.date)}
            {meetingNote.attendees.length > 0 ? ` · ${meetingNote.attendees.join(', ')}` : ''}
          </p>
        </div>
      )
    }
    return item.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p> : null
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Timeline</h2>
          <p className="text-[11px] text-muted-foreground">Internal only</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setGranolaOpen(true)}>
            Import from Granola
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMeetingOpen(true)}>
            Add meeting note
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!leadPhone?.trim()}
            aria-describedby={leadPhone?.trim() ? undefined : 'lead-log-call-help'}
            title={leadPhone?.trim() ? undefined : 'Add a lead phone number before logging a call'}
            onClick={openSoftphone}
          >
            Log call
          </Button>
          {!leadPhone?.trim() && (
            <span id="lead-log-call-help" className="sr-only">
              Add a lead phone number before logging a call
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Input
          aria-label="New note"
          value={body}
          onChange={event => setBody(event.target.value)}
          placeholder="Add an internal note"
        />
        <Button type="button" disabled={pending || !body.trim()} onClick={() => void addNote()}>
          Add note
        </Button>
      </div>
      <p aria-live="polite" role={error ? 'alert' : undefined} className="mt-1 text-sm text-destructive">
        {error}
      </p>

      {meetingOpen && (
        <div role="dialog" aria-modal="true" aria-label="Add meeting note" className="mt-4 space-y-2 rounded-md border p-3">
          <Input autoFocus aria-label="Meeting title" value={meeting.title} onChange={event => setMeeting(current => ({ ...current, title: event.target.value }))} />
          <Input aria-label="Meeting date" type="date" value={meeting.date} onChange={event => setMeeting(current => ({ ...current, date: event.target.value }))} />
          <Input aria-label="Attendees" value={meeting.attendees} onChange={event => setMeeting(current => ({ ...current, attendees: event.target.value }))} />
          <textarea aria-label="Meeting notes" className="w-full rounded-md border p-2" value={meeting.body} onChange={event => setMeeting(current => ({ ...current, body: event.target.value }))} />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !meeting.title.trim() || !meeting.date || !meeting.attendees.trim() || !meeting.body.trim()}
              onClick={() => void addMeeting()}
            >
              Save meeting note
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setMeetingOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Timeline filters">
        {FILTERS.map(option => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={filter === option.value ? 'secondary' : 'ghost'}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div aria-label="Lead timeline" className="mt-5 space-y-0">
        {visibleItems.map((item, index) => {
          const Icon = markerIcon(item.kind)
          const note = item.editableNoteId
            ? notes.find(candidate => candidate.id === item.editableNoteId)
            : null
          const meetingId = item.kind === 'meeting' ? item.id.slice('meeting:'.length) : null
          return (
            <article key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < visibleItems.length - 1 && (
                <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border" />
              )}
              <span className="relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {meetingId ? (
                    <button
                      type="button"
                      className="text-left text-sm font-medium"
                      aria-expanded={expandedMeetingId === meetingId}
                      onClick={() => setExpandedMeetingId(current => current === meetingId ? null : meetingId)}
                    >
                      {item.title}
                    </button>
                  ) : (
                    <p className="text-sm font-medium">{item.title}</p>
                  )}
                  {item.kind !== 'call' && (
                    <p className="text-xs text-muted-foreground">
                      {item.actorName} · <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
                    </p>
                  )}
                </div>

                {note && editingNoteId === note.id ? (
                  <div className="mt-2 flex gap-2">
                    <Input aria-label="Edit note body" value={editBody} onChange={event => setEditBody(event.target.value)} />
                    <Button type="button" size="sm" disabled={pending || !editBody.trim()} onClick={() => void saveNote(note.id)}>
                      Save note
                    </Button>
                  </div>
                ) : renderBody(item)}

                {note && (currentUser.id === note.actorId || currentUser.role === 'admin') && (
                  <div className="mt-1 flex gap-2">
                    <Button
                      type="button"
                      disabled={pending}
                      variant="ghost"
                      size="sm"
                      aria-label="Edit note"
                      onClick={() => {
                        setEditingNoteId(note.id)
                        setEditBody(note.body)
                      }}
                    >
                      Edit
                    </Button>
                    <Button type="button" disabled={pending} variant="ghost" size="sm" aria-label="Delete note" onClick={() => void removeNote(note.id)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </article>
          )
        })}
        {visibleItems.length === 0 && <p className="py-3 text-sm text-muted-foreground">No timeline items for this filter.</p>}
      </div>

      {initialCalls.length === 0 && !callsError && (
        <p className="mt-4 text-xs text-muted-foreground">No calls logged yet.</p>
      )}
      {callsError && (
        <p className="mt-4 text-xs text-muted-foreground">Calls unavailable: {callsError}</p>
      )}

      {granolaOpen && (
        <AddMeetingNotesDialog
          open={granolaOpen}
          onOpenChange={setGranolaOpen}
          target={{ kind: 'lead', id: leadId }}
          onImported={note => {
            const imported = mapMeetingNoteApiRow(note as LeadMeetingNoteApiRow)
            setMeetings(current => sortMeetings([
              ...current.filter(existing => existing.id !== imported.id),
              imported,
            ]))
            void onActivityChange?.()
          }}
        />
      )}
    </section>
  )
}
