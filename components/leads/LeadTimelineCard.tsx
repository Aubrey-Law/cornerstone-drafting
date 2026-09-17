'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CircleDot, MessageSquareText } from 'lucide-react'
import { LeadLogCallDialog } from './LeadLogCallDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormattedNote } from '@/components/notes/FormattedNote'
import { FormattedNoteEditor } from '@/components/notes/FormattedNoteEditor'
import { useConfirm } from '@/components/useConfirm'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  buildLeadTimeline,
  filterLeadTimeline,
  type LeadTimelineActivity,
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
  actorNames?: Record<string, string>
  actorError?: string | null
  dataRefreshWarning?: string | null
  activityRefreshWarning?: string | null
  currentUser: { id: string; role: string }
  onActivityChange?: () => void | Promise<void>
  onCommittedTouch?: (timestamp: string) => void
  onNotesChange?: (notes: LeadTimelineNote[]) => void
  onMeetingNotesChange?: (notes: LeadTimelineMeeting[]) => void
  addNoteRequest?: number
  /** `plain` drops the card chrome so the workspace tab owns the frame. */
  variant?: 'card' | 'plain'
  /** Pins the timeline to one filter and hides the filter row (Notes tab). */
  lockedFilter?: LeadTimelineFilter
}

const FILTERS: Array<{ value: LeadTimelineFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'notes', label: 'Notes' },
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
  return CircleDot
}

export function LeadTimelineCard({
  leadId,
  initialNotes,
  initialMeetingNotes,
  initialActivity = [],
  actorNames = {},
  actorError = null,
  dataRefreshWarning = null,
  activityRefreshWarning: externalActivityRefreshWarning = null,
  currentUser,
  onActivityChange,
  onCommittedTouch,
  onNotesChange,
  onMeetingNotesChange,
  addNoteRequest,
  variant = 'card',
  lockedFilter,
}: Props) {
  const { confirm, confirmDialog } = useConfirm()
  const token = useAccessToken()
  const [notes, setNotes] = useState(() => sortNotes(initialNotes))
  const [meetings, setMeetings] = useState(() => sortMeetings(initialMeetingNotes))
  const [filter, setFilter] = useState<LeadTimelineFilter>(lockedFilter ?? 'all')
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [granolaOpen, setGranolaOpen] = useState(false)
  const [meeting, setMeeting] = useState({ title: '', date: '', attendees: '', body: '' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localActivityRefreshWarning, setLocalActivityRefreshWarning] = useState<string | null>(null)
  const [callOpen, setCallOpen] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setNotes(sortNotes(initialNotes)) }, [initialNotes])
  useEffect(() => { setMeetings(sortMeetings(initialMeetingNotes)) }, [initialMeetingNotes])
  useEffect(() => { if (addNoteRequest) noteRef.current?.focus() }, [addNoteRequest])
  function updateNotes(rows: LeadTimelineNote[]) { setNotes(rows); onNotesChange?.(rows) }
  function updateMeetings(rows: LeadTimelineMeeting[]) { setMeetings(rows); onMeetingNotesChange?.(rows) }

  const effectiveFilter = lockedFilter ?? filter
  const items = useMemo(() => buildLeadTimeline({
    notes,
    meetings,
    activity: initialActivity,
    actorNames,
  }), [notes, meetings, initialActivity, actorNames])
  const visibleItems = filterLeadTimeline(items, effectiveFilter)

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed')
      setPending(false)
      return
    }
    try {
      await onActivityChange?.()
      setLocalActivityRefreshWarning(null)
    } catch (caught) {
      setLocalActivityRefreshWarning(caught instanceof Error ? caught.message : 'Could not refresh timeline')
    } finally {
      setPending(false)
    }
  }

  async function addNote() {
    await mutate(async () => {
      const json = await call(`/api/admin/leads/${leadId}/notes`, 'POST', { body })
      const added = json.note as LeadTimelineNote
      updateNotes(sortNotes([...notes, added]))
      setBody('')
    })
  }

  async function saveNote(id: string) {
    await mutate(async () => {
      const json = await call(`/api/admin/leads/${leadId}/notes/${id}`, 'PATCH', { body: editBody })
      updateNotes(sortNotes(notes.map(note => note.id === id ? json.note : note)))
      setEditingNoteId(null)
    })
  }

  async function removeNote(id: string) {
    const confirmed = await confirm({
      title: 'Delete this note?',
      body: 'This cannot be undone.',
      confirmLabel: 'Delete note',
      destructive: true,
    })
    if (!confirmed) return
    await mutate(async () => {
      await call(`/api/admin/leads/${leadId}/notes/${id}`, 'DELETE')
      updateNotes(notes.filter(note => note.id !== id))
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
      updateMeetings(sortMeetings([...meetings, added]))
      setMeetingOpen(false)
    })
  }

  function renderBody(item: LeadTimelineItem) {
    if (item.kind === 'meeting') {
      const meetingNote = meetings.find(candidate => `meeting:${candidate.id}` === item.id)
      if (!meetingNote || expandedMeetingId !== meetingNote.id) return null
      return (
        <div className="mt-2 space-y-1 text-sm">
          <FormattedNote>{meetingNote.body}</FormattedNote>
          <p className="text-xs text-muted-foreground">
            Meeting date: {formatDateDetail(meetingNote.date)}
            {meetingNote.attendees.length > 0 ? ` · ${meetingNote.attendees.join(', ')}` : ''}
          </p>
        </div>
      )
    }
    if (!item.body) return null
    return item.kind === 'note'
      ? <FormattedNote className="mt-1 text-muted-foreground">{item.body}</FormattedNote>
      : <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
  }

  return (
    <section className={variant === 'card' ? 'rounded-lg border border-border bg-card p-4 md:p-5' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={variant === 'card' ? 'text-sm font-semibold' : 'sr-only'}>Timeline</h2>
          {variant === 'card' && <p className="text-micro text-muted-foreground">Internal only</p>}
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
            onClick={() => setCallOpen(true)}
          >
            Log call
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FormattedNoteEditor
          textareaRef={noteRef}
          ariaLabel="New note"
          value={body}
          onChange={setBody}
          placeholder="Add an internal note"
          />
        </div>
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
          <FormattedNoteEditor
            ariaLabel="Meeting notes"
            value={meeting.body}
            onChange={value => setMeeting(current => ({ ...current, body: value }))}
          />
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

      {!lockedFilter && (
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
      )}

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
                  <p className="text-xs text-muted-foreground">
                    {item.actorName} · <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
                  </p>
                </div>

                {note && editingNoteId === note.id ? (
                  <div className="mt-2 flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <FormattedNoteEditor ariaLabel="Edit note body" value={editBody} onChange={setEditBody} />
                    </div>
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

      {actorError && (
        <p className="mt-4 text-xs text-muted-foreground">Actor names unavailable: {actorError}</p>
      )}
      {dataRefreshWarning && (
        <p className="mt-4 text-xs text-muted-foreground">
          Lead data refresh unavailable: {dataRefreshWarning}
        </p>
      )}
      {(localActivityRefreshWarning ?? externalActivityRefreshWarning) && (
        <p className="mt-4 text-xs text-muted-foreground">
          Timeline refresh unavailable: {localActivityRefreshWarning ?? externalActivityRefreshWarning}
        </p>
      )}

      <LeadLogCallDialog leadId={leadId} open={callOpen} onOpenChange={setCallOpen}
        onSaved={async (timestamp, contacted) => {
          if (contacted) onCommittedTouch?.(timestamp)
          await onActivityChange?.()
        }} />
      {granolaOpen && (
        <AddMeetingNotesDialog
          open={granolaOpen}
          onOpenChange={setGranolaOpen}
          target={{ kind: 'lead', id: leadId }}
          onImported={note => {
            const imported = mapMeetingNoteApiRow(note as LeadMeetingNoteApiRow)
            updateMeetings(sortMeetings([
              ...meetings.filter(existing => existing.id !== imported.id),
              imported,
            ]))
            void (async () => {
              try {
                await onActivityChange?.()
                setLocalActivityRefreshWarning(null)
              } catch (caught) {
                setLocalActivityRefreshWarning(caught instanceof Error ? caught.message : 'Could not refresh timeline')
              }
            })()
          }}
        />
      )}
      {confirmDialog}
    </section>
  )
}
