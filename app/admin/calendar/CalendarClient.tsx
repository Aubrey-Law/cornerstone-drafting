'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { DayAgenda } from './DayAgenda'
import { EventPrepDrawer } from './EventPrepDrawer'
import { PlanView } from './PlanView'
import { QuickBookPopover } from './QuickBookPopover'
import {
  type AttentionItem,
  type BookableType,
  type CalendarAppointment,
  type CalendarRailData,
  type CalendarView,
  type OutlookCalendarRef,
  type OutlookEvent,
  type PlanData,
  LOCATION_LABEL,
  allowedFormats,
} from './types'
import {
  BLOCK_HATCH,
  CATEGORY_LEGEND,
  CATEGORY_STYLE,
  categorize,
  isBlock,
} from './eventCategories'
import { endMinutesOfDay, minutesOfDay, timeGridBounds } from './timeGrid'

/** Last two segments of a matter number, e.g. "2026-EP-Example-007" → "Example-007". */
function shortMatterLabel(matterNumber: string): string {
  return matterNumber.split('-').slice(-2).join('-')
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SLOT_MIN = 30
const SLOT_PX = 40

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Names the Outlook calendar an event came from, for tooltips. */
function outlookSource(event: OutlookEvent): string {
  return event.calendarName ? `Outlook · ${event.calendarName}` : 'Outlook'
}

function availabilityLabel(appointment: CalendarAppointment): string {
  return appointment.calendarShowAsBusy === false ? 'Free' : 'Busy'
}

function availabilityClass(appointment: CalendarAppointment): string {
  return appointment.calendarShowAsBusy === false
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-rose-100 text-rose-700'
}

function fmtDayHeading(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtGridHour(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${suffix}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay())
}

/** The 42-cell (6-week) Sunday-start grid containing the given month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

function toDateInputValue(d: Date): string {
  return dayKey(d)
}

interface RescheduleDraft {
  id: string
  label: string
  date: string
  time: string
}

interface PlanBlockDraft {
  id: string
  date: string
  time: string
  title: string
  durationMinutes: string
  showAsBusy: boolean
  matterId: string | null
  leadId: string | null
}

function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function parseIntOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Key Outlook events by day. Timed events use the local start day; all-day
 * events use the UTC date parts (Graph reports them as UTC midnights) and
 * expand across each day they span.
 */
function outlookEventsByDay(events: OutlookEvent[]): Map<string, OutlookEvent[]> {
  const map = new Map<string, OutlookEvent[]>()
  const push = (key: string, e: OutlookEvent) => {
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  }
  for (const e of events) {
    if (e.isAllDay) {
      const start = e.startIso.slice(0, 10)
      const end = e.endIso.slice(0, 10)
      for (
        let d = new Date(`${start}T12:00:00Z`);
        d.toISOString().slice(0, 10) < end;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        push(d.toISOString().slice(0, 10), e)
      }
    } else {
      push(dayKey(new Date(e.startIso)), e)
    }
  }
  return map
}

export function CalendarClient() {
  const token = useAccessToken()
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState<CalendarView>('week')
  const [anchor, setAnchor] = useState<Date>(startOfDay(today))
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([])
  const [types, setTypes] = useState<BookableType[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string>(dayKey(today))
  const [quickBookOpen, setQuickBookOpen] = useState(false)
  const [quickBookPrefill, setQuickBookPrefill] = useState<string | null>(null)
  const [reschedule, setReschedule] = useState<RescheduleDraft | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [showOutlook, setShowOutlook] = useState(true)
  const [outlookEvents, setOutlookEvents] = useState<OutlookEvent[]>([])
  const [outlookConnected, setOutlookConnected] = useState(true)
  const [outlookCalendars, setOutlookCalendars] = useState<OutlookCalendarRef[]>([])
  const [outlookTruncated, setOutlookTruncated] = useState(false)
  const [outlookError, setOutlookError] = useState<string | null>(null)
  const [outlookSkipped, setOutlookSkipped] = useState<string[]>([])
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [rail, setRail] = useState<CalendarRailData>({ datesThisWeek: [], followUps: [], openSlots: [] })
  const [planData, setPlanData] = useState<PlanData | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null)
  const [previewEvents, setPreviewEvents] = useState<OutlookEvent[]>([])
  const [planBlock, setPlanBlock] = useState<PlanBlockDraft | null>(null)
  const [planBlockSubmitting, setPlanBlockSubmitting] = useState(false)

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const range = useMemo((): { from: Date; to: Date } => {
    if (view === 'day') return { from: startOfDay(anchor), to: addDays(anchor, 1) }
    if (view === 'week') {
      const from = startOfWeek(anchor)
      return { from, to: addDays(from, 7) }
    }
    if (view === 'plan') return { from: startOfDay(anchor), to: addDays(anchor, 16) }
    const grid = monthGrid(anchor.getFullYear(), anchor.getMonth())
    return { from: grid[0], to: addDays(grid[41], 1) }
  }, [view, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    const rangeQuery = `from=${range.from.toISOString()}&to=${range.to.toISOString()}`
    try {
      const [apptRes, outlookRes] = await Promise.all([
        fetch(`/api/admin/scheduling/appointments?${rangeQuery}`, { headers: authHeaders() }),
        showOutlook
          ? fetch(`/api/admin/scheduling/outlook-events?${rangeQuery}`, { headers: authHeaders() })
          : Promise.resolve(null),
      ])
      if (!apptRes.ok) {
        toast.error('Failed to load appointments')
        return
      }
      const json = await apptRes.json()
      setTypes((json.types ?? []).filter((t: BookableType) => t.active))
      let appointmentRows: CalendarAppointment[] = json.appointments ?? []
      if (outlookRes) {
        const outlookJson = outlookRes.ok
          ? await outlookRes.json()
          : { connected: false, events: [], calendars: [], truncated: false }
        setOutlookEvents(outlookJson.events ?? [])
        setOutlookConnected(Boolean(outlookJson.connected))
        setOutlookCalendars(outlookJson.calendars ?? [])
        setOutlookTruncated(Boolean(outlookJson.truncated))
        setOutlookSkipped(outlookJson.skipped ?? [])
        setOutlookError(
          outlookRes.ok
            ? (typeof outlookJson.error === 'string' ? outlookJson.error : null)
            : `Outlook request failed (${outlookRes.status})`,
        )
        // The Outlook fetch also mirrors Outlook-side moves and deletions back
        // onto the appointment rows. Those writes land after the parallel
        // appointments read, so re-read once when anything actually changed.
        const synced = outlookJson.synced as { moved?: number; cancelled?: number } | undefined
        const changed = (synced?.moved ?? 0) + (synced?.cancelled ?? 0)
        if (changed > 0) {
          const resyncRes = await fetch(`/api/admin/scheduling/appointments?${rangeQuery}`, {
            headers: authHeaders(),
          })
          if (resyncRes.ok) {
            appointmentRows = (await resyncRes.json()).appointments ?? appointmentRows
          }
          toast.info(
            `Synced ${changed} appointment${changed === 1 ? '' : 's'} from Outlook`,
          )
        }
      } else {
        setOutlookEvents([])
        setOutlookCalendars([])
        setOutlookTruncated(false)
        setOutlookSkipped([])
        setOutlookError(null)
      }
      setAppointments(appointmentRows)
    } catch {
      toast.error('Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }, [range, authHeaders, showOutlook])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuickBookPrefill(null)
        setQuickBookOpen(open => !open)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const rows = (event as CustomEvent<Array<{ id: string; title: string; payload: Record<string, unknown> }>>).detail
      if (!Array.isArray(rows)) return
      const ghosts = rows.flatMap(row => {
        const start = typeof row.payload.start === 'string'
          ? row.payload.start
          : typeof row.payload.new_start === 'string'
            ? row.payload.new_start
            : ''
        const end = typeof row.payload.end === 'string'
          ? row.payload.end
          : start
            ? new Date(Date.parse(start) + 60 * 60_000).toISOString()
            : ''
        if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return []
        return [{
          id: `preview:${row.id}`,
          subject: `Proposed · ${row.title}`,
          startIso: new Date(start).toISOString(),
          endIso: new Date(end).toISOString(),
          isAllDay: false,
          showAs: 'tentative',
        }]
      })
      setPreviewEvents(ghosts)
      if (ghosts[0]) {
        setAnchor(startOfDay(new Date(ghosts[0].startIso)))
        setSelectedDay(dayKey(new Date(ghosts[0].startIso)))
      }
    }
    window.addEventListener('calendar:preview-proposals', handler)
    return () => window.removeEventListener('calendar:preview-proposals', handler)
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>()
    for (const a of appointments) {
      const key = dayKey(new Date(a.startTime))
      const list = map.get(key) ?? []
      list.push(a)
      map.set(key, list)
    }
    return map
  }, [appointments])

  const outlookByDay = useMemo(
    () => outlookEventsByDay(showOutlook ? [...outlookEvents, ...previewEvents] : previewEvents),
    [outlookEvents, previewEvents, showOutlook],
  )

  function shift(delta: number) {
    if (view === 'month') {
      setAnchor(a => new Date(a.getFullYear(), a.getMonth() + delta, 1))
    } else if (view === 'day') {
      // The day view renders from selectedDay, not anchor, so move both.
      const next = addDays(selectedDate, delta)
      setAnchor(next)
      setSelectedDay(dayKey(next))
    } else {
      setAnchor(a => addDays(a, delta * (view === 'week' ? 7 : 1)))
    }
  }

  function openQuickBook(prefill?: { date?: Date; time?: string; iso?: string }) {
    let iso = prefill?.iso ?? null
    if (!iso && prefill?.date) {
      const time = prefill.time ?? '09:00'
      iso = new Date(`${toDateInputValue(prefill.date)}T${time}`).toISOString()
    }
    setQuickBookPrefill(iso)
    setQuickBookOpen(true)
  }

  const patchAppointment = useCallback(
    async (payload: Record<string, unknown>, successMessage: string): Promise<boolean> => {
      setActing(true)
      try {
        const res = await fetch('/api/admin/scheduling/appointments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(json.error ?? 'Action failed')
          return false
        }
        toast.success(successMessage)
        void load()
        return true
      } catch {
        toast.error('Action failed')
        return false
      } finally {
        setActing(false)
      }
    },
    [authHeaders, load],
  )

  const heading =
    view === 'month'
      ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${startOfWeek(anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addDays(startOfWeek(anchor), 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : view === 'plan'
          ? 'Planning horizon'
          : fmtDayHeading(anchor)

  const todayKey = dayKey(today)
  const selectedAppointments = byDay.get(selectedDay) ?? []
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [selectedDay])

  const selectedOutlook = outlookByDay.get(selectedDay) ?? []
  const selectedBlocks = selectedOutlook.filter(isBlock)

  useEffect(() => {
    if (view !== 'day') return
    let stale = false
    void (async () => {
      const response = await fetch(`/api/admin/calendar/attention?date=${selectedDay}`, { headers: authHeaders() })
      const body = response.ok ? await response.json() : { items: [], rail: { datesThisWeek: [], followUps: [], openSlots: [] } }
      if (stale) return
      setAttention(body.items ?? [])
      let nextRail = body.rail ?? { datesThisWeek: [], followUps: [], openSlots: [] }
      const firstType = types[0]
      if (firstType) {
        const from = new Date(`${selectedDay}T00:00:00`)
        const to = addDays(from, 1)
        const params = new URLSearchParams({
          typeId: firstType.id,
          locationType: allowedFormats(firstType)[0],
          from: from.toISOString(),
          to: to.toISOString(),
        })
        const slotsResponse = await fetch(`/api/admin/scheduling/slots?${params}`, { headers: authHeaders() })
        const slotsBody = slotsResponse.ok ? await slotsResponse.json() : { slots: [] }
        nextRail = { ...nextRail, openSlots: slotsBody.slots ?? [] }
      }
      if (!stale) setRail(nextRail)
    })()
    return () => { stale = true }
  }, [view, selectedDay, types, authHeaders])

  useEffect(() => {
    if (view !== 'plan') return
    let stale = false
    setPlanData(null)
    void fetch(`/api/admin/calendar/plan?from=${encodeURIComponent(anchor.toISOString())}`, { headers: authHeaders() })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!stale) setPlanData(body) })
    return () => { stale = true }
  }, [view, anchor, authHeaders])

  async function dismissAttention(id: string) {
    setAttention(items => items.filter(item => item.id !== id))
    const response = await fetch('/api/admin/calendar/attention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ itemId: id, date: selectedDay }),
    })
    if (!response.ok) {
      toast.error('Could not save that dismissal')
      const refreshed = await fetch(`/api/admin/calendar/attention?date=${selectedDay}`, { headers: authHeaders() })
      if (refreshed.ok) setAttention((await refreshed.json()).items ?? [])
    }
  }

  function beginReschedule(a: CalendarAppointment) {
    const start = new Date(a.startTime)
    setReschedule({
      id: a.id,
      label: `${a.typeLabel} — ${a.attendeeName}`,
      date: dayKey(start),
      time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    })
  }

  function openPlanBlock(deadline: PlanData['deadlines'][number]) {
    const parsedDate = Number.isFinite(Date.parse(deadline.date)) ? new Date(deadline.date) : null
    const fallbackDate = new Date(`${dayKey(selectedDate)}T09:00:00`)
    const date = toDateInputValue(parsedDate ?? fallbackDate)
    const time = toTimeInputValue(parsedDate ?? fallbackDate)
    const durationMinutes = parseIntOrNull(`${deadline.durationMinutes}`) ?? 30

    setPlanBlock({
      id: deadline.id,
      date,
      time,
      title: deadline.label,
      durationMinutes: String(durationMinutes),
      showAsBusy: true,
      matterId: deadline.matterId ?? null,
      leadId: deadline.leadId ?? null,
    })
  }

  async function createPlanBlock() {
    if (!planBlock) return
    const durationMinutes = parseIntOrNull(planBlock.durationMinutes)
    const start = new Date(`${planBlock.date}T${planBlock.time}`)
    if (!durationMinutes) {
      toast.error('Block duration must be a positive number.')
      return
    }
    if (!Number.isFinite(start.getTime())) {
      toast.error('Add a valid date and time for the block.')
      return
    }
    if (!planBlock.matterId && !planBlock.leadId) {
      toast.error('This deadline is not tied to a matter or lead yet.')
      return
    }

    setPlanBlockSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        title: planBlock.title.trim() || 'Task block',
        due_at: start.toISOString(),
        calendarAddToCalendar: true,
        calendarStartAt: start.toISOString(),
        calendarDurationMinutes: durationMinutes,
        calendarShowAsBusy: planBlock.showAsBusy,
      }
      if (planBlock.matterId) payload.matter_id = planBlock.matterId
      else payload.lead_id = planBlock.leadId

      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(json.error ?? 'Could not create that block')
        return
      }

      toast.success('Planned block created and added to calendar')
      setPlanBlock(null)
      void load()
    } finally {
      setPlanBlockSubmitting(false)
    }
  }

  const dayPanel = (
    <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">{fmtDayHeading(selectedDate)}</h2>
          {selectedOutlook.filter(e => !isBlock(e)).length > 0 && (
            <div className="mt-2 space-y-0.5">
              {selectedOutlook.filter(e => !isBlock(e)).map(e => (
                <p key={e.id} className="text-xs text-muted-foreground">
                  <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] uppercase">Outlook</span>
                  {e.isAllDay ? 'All day' : `${fmtTime(e.startIso)}–${fmtTime(e.endIso)}`} · {e.subject}
                </p>
              ))}
            </div>
          )}
          {selectedAppointments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No appointments.</p>
          ) : (
            <div className="mt-2 divide-y divide-border">
              {selectedAppointments.map(a => {
                const isPast = Date.parse(a.startTime) < Date.now()
                return (
                  <div key={a.id} className="py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className={cn('text-sm text-foreground', a.status === 'cancelled' && 'line-through')}>
                          <span
                            className="mr-1.5 inline-block h-2 w-2 rounded-[3px] align-middle"
                            style={{ background: CATEGORY_STYLE[categorize(a.typeLabel)].dot }}
                            aria-hidden
                          />
                          {fmtTime(a.startTime)}–{fmtTime(a.endTime)} · {a.typeLabel} — {a.attendeeName}
                          {a.status !== 'scheduled' && (
                            <span className="ml-2 text-xs uppercase text-muted-foreground">
                              {a.status.replace('_', ' ')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.attendeeEmail}
                          {a.attendeePhone ? ` · ${a.attendeePhone}` : ''}
                          {a.secondAttendeeEmail ? ` · +${a.secondAttendeeName || a.secondAttendeeEmail}` : ''}
                          {a.locationType ? ` · ${LOCATION_LABEL[a.locationType]}` : ''}
                          <span
                            className={cn('ml-1 inline-block rounded-full px-1.5 py-0.5', availabilityClass(a))}
                          >
                            {availabilityLabel(a)}
                          </span>
                          {a.source === 'calendly' && (
                            <span className="ml-2 text-primary">Calendly</span>
                          )}
                          {a.source !== 'calendly' && !a.calendarSynced && a.status === 'scheduled' && (
                            <span className="ml-2 text-amber-700">⚠ not on Outlook calendar</span>
                          )}
                        </p>
                        {a.notes && <p className="mt-1 text-xs text-muted-foreground">{a.notes}</p>}
                      </div>
                      {a.linkedMatterId ? (
                        <Link href={`/admin/matters/${a.linkedMatterId}`} className="text-xs text-primary underline">
                          View matter
                        </Link>
                      ) : a.linkedLeadId ? (
                        <Link href={`/admin/crm/opportunities/${a.linkedLeadId}`} className="text-xs text-primary underline">
                          View lead
                        </Link>
                      ) : null}
                    </div>
                    {a.status === 'scheduled' && a.source !== 'calendly' && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {confirmingId === a.id ? (
                          <>
                            <span className="text-xs text-muted-foreground">
                              {isPast ? 'Mark as no-show?' : 'Cancel this appointment? The client will be notified.'}
                            </span>
                            {isPast ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={acting}
                                  onClick={() => {
                                    void patchAppointment(
                                      { appointmentId: a.id, action: 'no_show', sendFollowUp: true },
                                      'Marked no-show — follow-up email sent',
                                    ).then(ok => ok && setConfirmingId(null))
                                  }}
                                >
                                  No-show + follow-up email
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={acting}
                                  onClick={() => {
                                    void patchAppointment(
                                      { appointmentId: a.id, action: 'no_show', sendFollowUp: false },
                                      'Marked no-show',
                                    ).then(ok => ok && setConfirmingId(null))
                                  }}
                                >
                                  No-show only
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={acting}
                                onClick={() => {
                                  void patchAppointment(
                                    { appointmentId: a.id, action: 'cancel' },
                                    'Appointment cancelled — client notified',
                                  ).then(ok => ok && setConfirmingId(null))
                                }}
                              >
                                Confirm cancel
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                              Keep it
                            </Button>
                          </>
                        ) : (
                          <>
                            {!isPast && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const start = new Date(a.startTime)
                                    setReschedule({
                                      id: a.id,
                                      label: `${a.typeLabel} — ${a.attendeeName}`,
                                      date: dayKey(start),
                                      time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                                    })
                                  }}
                                >
                                  Reschedule
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmingId(a.id)}>
                                  Cancel…
                                </Button>
                              </>
                            )}
                            {isPast && (
                              <Button size="sm" variant="ghost" onClick={() => setConfirmingId(a.id)}>
                                Mark no-show…
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {selectedBlocks.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {selectedBlocks
                .map(b =>
                  b.isAllDay
                    ? 'Blocked all day'
                    : `Blocked ${fmtTime(b.startIso)}–${fmtTime(b.endIso)}`,
                )
                .join(' · ')}{' '}
              · shown as background, not events
            </p>
          )}
    </section>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(['day', 'week', 'month', 'plan'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  if (v === 'day') setAnchor(selectedDate)
                  setView(v)
                }}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  view === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => shift(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAnchor(startOfDay(today))
              setSelectedDay(todayKey)
            }}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => shift(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-1 text-sm font-medium text-foreground">{heading}</span>
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={
              outlookConnected
                ? 'Show your Outlook events alongside booked appointments'
                : 'Outlook is not connected — connect it from Settings → Outlook'
            }
          >
            <input
              type="checkbox"
              checked={showOutlook}
              onChange={e => setShowOutlook(e.target.checked)}
            />
            Outlook events
            {showOutlook && !outlookConnected && (
              <span className="text-amber-700" title={outlookError ?? undefined}>
                ⚠ not connected{outlookError ? ` — ${outlookError}` : ''}
              </span>
            )}
            {showOutlook && outlookConnected && outlookSkipped.length > 0 && (
              <span
                className="text-amber-700"
                title={`Outlook would not return these calendars: ${outlookSkipped.join(', ')}`}
              >
                ⚠ {outlookSkipped.length} calendar
                {outlookSkipped.length === 1 ? '' : 's'} unavailable
              </span>
            )}
            {showOutlook && outlookConnected && outlookCalendars.length > 1 && (
              <span title={outlookCalendars.map(c => c.name).join(', ')}>
                · {outlookCalendars.length} calendars
              </span>
            )}
            {showOutlook && outlookTruncated && (
              <span
                className="text-amber-700"
                title="Outlook returned more events than this view reads. Narrow the range to see the rest."
              >
                ⚠ partial
              </span>
            )}
          </label>
          <QuickBookPopover
            open={quickBookOpen}
            onOpenChange={setQuickBookOpen}
            types={types}
            prefillIso={quickBookPrefill}
            authHeaders={authHeaders}
            onBooked={() => void load()}
          />
          <Button asChild variant="ghost" size="sm" title="Scheduling settings">
            <Link href="/admin/settings?tab=scheduling">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'flex-wrap items-center gap-3 text-[11px] text-foreground',
          // Month, week and day all colour events by category, so all three
          // need the key. Only the plan view has no coloured events.
          view !== 'plan' ? 'flex' : 'hidden',
        )}
      >
        {CATEGORY_LEGEND.map(({ category, label }) => (
          <span key={category} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[3px] border"
              style={{
                background: CATEGORY_STYLE[category].bg,
                borderColor: CATEGORY_STYLE[category].dot,
              }}
            />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundImage: BLOCK_HATCH }} />
          Blocked
        </span>
      </div>

      <div className={cn('flex items-start gap-3', loading && 'opacity-60')}>
        <div className="min-w-0 flex-1">
          {view === 'month' ? (
            <MonthGrid
              anchor={anchor}
              byDay={byDay}
              outlookByDay={outlookByDay}
              todayKey={todayKey}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onEventClick={setSelectedAppointment}
            />
          ) : view === 'week' ? (
            <TimeGrid
              days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))}
              byDay={byDay}
              outlookByDay={outlookByDay}
              todayKey={todayKey}
              onSlotClick={(date, time) => openQuickBook({ date, time })}
              onEventClick={setSelectedAppointment}
            />
          ) : view === 'day' ? (
            <DayAgenda
              date={selectedDate}
              appointments={selectedAppointments}
              outlookEvents={selectedOutlook}
              attention={attention}
              rail={rail}
              onDismissAttention={id => void dismissAttention(id)}
              onOpenAppointment={setSelectedAppointment}
              onReschedule={beginReschedule}
              onBookSlot={iso => openQuickBook(iso ? { iso } : { date: selectedDate })}
            />
          ) : (
              <PlanView
                data={planData}
                onBook={openPlanBlock}
                onAskAssistant={prompt => window.dispatchEvent(new CustomEvent('cornerstone:chat-open', { detail: { prompt } }))}
              />
            )}
        </div>
        {view === 'week' && <div className="w-[300px] shrink-0">{dayPanel}</div>}
      </div>

      {view === 'month' && dayPanel}

      <Dialog open={planBlock !== null} onOpenChange={open => !open && setPlanBlock(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Block calendar time</DialogTitle>
          </DialogHeader>
          {planBlock && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Create a calendar hold from a task deadline.</p>
              <div>
                <Label htmlFor="plan-block-title">Title</Label>
                <Input
                  id="plan-block-title"
                  className="mt-1"
                  value={planBlock.title}
                  onChange={event => setPlanBlock({ ...planBlock, title: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="plan-block-date">Date</Label>
                  <Input
                    id="plan-block-date"
                    className="mt-1"
                    type="date"
                    value={planBlock.date}
                    onChange={event => setPlanBlock({ ...planBlock, date: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="plan-block-time">Start</Label>
                  <Input
                    id="plan-block-time"
                    className="mt-1"
                    type="time"
                    value={planBlock.time}
                    onChange={event => setPlanBlock({ ...planBlock, time: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="plan-block-duration">Duration (minutes)</Label>
                <Input
                  id="plan-block-duration"
                  className="mt-1"
                  type="number"
                  min="1"
                  value={planBlock.durationMinutes}
                  onChange={event => setPlanBlock({ ...planBlock, durationMinutes: event.target.value })}
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={planBlock.showAsBusy}
                  onChange={event => setPlanBlock({ ...planBlock, showAsBusy: event.target.checked })}
                />
                Show as busy
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPlanBlock(null)}
                  disabled={planBlockSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  disabled={planBlockSubmitting}
                  onClick={() => void createPlanBlock()}
                >
                  {planBlockSubmitting ? 'Creating…' : 'Create block'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <EventPrepDrawer
        appointment={selectedAppointment}
        open={selectedAppointment !== null}
        onOpenChange={open => !open && setSelectedAppointment(null)}
        authHeaders={authHeaders}
        onReschedule={beginReschedule}
        onBookNext={appointment => {
          setSelectedAppointment(null)
          openQuickBook({ date: addDays(new Date(appointment.startTime), 7) })
        }}
      />

      <Dialog open={reschedule !== null} onOpenChange={open => !open && setReschedule(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule appointment</DialogTitle>
          </DialogHeader>
          {reschedule && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{reschedule.label}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="resched-date">New date</Label>
                  <Input
                    id="resched-date"
                    className="mt-1"
                    type="date"
                    value={reschedule.date}
                    onChange={e => setReschedule({ ...reschedule, date: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="resched-time">New time</Label>
                  <Input
                    id="resched-time"
                    className="mt-1"
                    type="time"
                    value={reschedule.time}
                    onChange={e => setReschedule({ ...reschedule, time: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Moves the Outlook event and emails the client the new time. Any free
                time works — client-facing hours and notice rules do not apply.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReschedule(null)} disabled={acting}>
                  Cancel
                </Button>
                <Button
                  disabled={acting}
                  onClick={() => {
                    const start = new Date(`${reschedule.date}T${reschedule.time}`)
                    if (!Number.isFinite(start.getTime())) {
                      toast.error('Invalid date or time')
                      return
                    }
                    void patchAppointment(
                      {
                        appointmentId: reschedule.id,
                        action: 'reschedule',
                        newStartIso: start.toISOString(),
                      },
                      'Appointment rescheduled — client notified',
                    ).then(ok => ok && setReschedule(null))
                  }}
                >
                  {acting ? 'Rescheduling…' : 'Reschedule'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MonthGrid(props: {
  anchor: Date
  byDay: Map<string, CalendarAppointment[]>
  outlookByDay: Map<string, OutlookEvent[]>
  todayKey: string
  selectedDay: string
  onSelectDay: (key: string) => void
  onEventClick: (appointment: CalendarAppointment) => void
}) {
  const { anchor, byDay, outlookByDay, todayKey, selectedDay, onSelectDay, onEventClick } = props
  const grid = monthGrid(anchor.getFullYear(), anchor.getMonth())

  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAY_HEADERS.map(d => (
          <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((date, i) => {
          const key = dayKey(date)
          const inMonth = date.getMonth() === anchor.getMonth()
          const dayAppointments = byDay.get(key) ?? []
          const allOutlook = outlookByDay.get(key) ?? []
          // Blocks collapse to one strip so they don't eat the three event slots.
          const blocks = allOutlook.filter(isBlock)
          const dayOutlook = allOutlook.filter(e => !isBlock(e))
          const blockLabel = blocks.some(b => b.isAllDay) ? 'Blocked all day' : 'Blocked'
          const shown = dayAppointments.slice(0, 3)
          const outlookShown = dayOutlook.slice(0, Math.max(0, 3 - shown.length))
          const hiddenCount =
            dayAppointments.length - shown.length + dayOutlook.length - outlookShown.length
          return (
            <div
              key={key}
              onClick={() => onSelectDay(key)}
              className={cn(
                'flex min-h-24 flex-col items-stretch gap-1 border-border p-1.5 text-left align-top transition-colors',
                i % 7 !== 0 && 'border-l',
                i >= 7 && 'border-t',
                !inMonth && 'bg-muted/30',
                key === selectedDay ? 'bg-primary/5 ring-1 ring-inset ring-primary' : 'hover:bg-muted/50',
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay(key)}
                className={cn(
                  'self-start rounded-full px-1.5 text-xs leading-5',
                  key === todayKey
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : inMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                )}
              >
                {date.getDate()}
              </button>
              {blocks.length > 0 && (
                <span
                  className="truncate rounded px-1 text-[10px] leading-4 text-muted-foreground"
                  style={{ backgroundImage: BLOCK_HATCH }}
                  title={blocks.map(b => b.subject).join(', ')}
                >
                  {blockLabel}
                </span>
              )}
              {shown.map(a => {
                const style = CATEGORY_STYLE[categorize(a.typeLabel)]
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={event => {
                      event.stopPropagation()
                      onEventClick(a)
                    }}
                    className={cn(
                      'truncate rounded px-1 py-0.5 text-left text-[11px] leading-4',
                      a.status === 'cancelled' && 'bg-muted text-muted-foreground line-through',
                    )}
                    style={
                      a.status === 'cancelled'
                        ? undefined
                        : { background: style.bg, color: style.text, borderLeft: `3px solid ${style.dot}` }
                    }
                    title={`${fmtTime(a.startTime)} ${a.typeLabel} — ${a.attendeeName}`}
                  >
                    {fmtTime(a.startTime)} {a.attendeeName}{' '}
                    <span
                      className={cn(
                        'inline-block rounded-full px-1.5 py-0.5 text-[10px]',
                        availabilityClass(a),
                      )}
                    >
                      {availabilityLabel(a)}
                    </span>
                  </button>
                )
              })}
              {outlookShown.map(e => {
                const style = CATEGORY_STYLE[categorize(e.subject)]
                return (
                  <span
                    key={e.id}
                    className="truncate rounded px-1 py-0.5 text-[11px] leading-4"
                    style={{ background: style.bg, color: style.text, borderLeft: `3px solid ${style.dot}` }}
                    title={`${e.isAllDay ? 'All day' : fmtTime(e.startIso)} ${e.subject} (${outlookSource(e)})`}
                  >
                    {e.isAllDay ? '◦' : fmtTime(e.startIso)} {e.subject}
                  </span>
                )
              })}
              {hiddenCount > 0 && (
                <span className="px-1 text-[11px] text-muted-foreground">+{hiddenCount} more</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimeGrid(props: {
  days: Date[]
  byDay: Map<string, CalendarAppointment[]>
  outlookByDay: Map<string, OutlookEvent[]>
  todayKey: string
  onSlotClick: (date: Date, time: string) => void
  onEventClick: (a: CalendarAppointment) => void
}) {
  const { days, byDay, outlookByDay, todayKey, onSlotClick, onEventClick } = props
  // Widened past the business window when the days on screen hold earlier or
  // later events, so nothing on the Outlook calendar falls off the grid.
  const { startMin: gridStartMin, endMin: gridEndMin } = timeGridBounds(days, byDay, outlookByDay)
  const slotCount = (gridEndMin - gridStartMin) / SLOT_MIN
  const gridHeight = slotCount * SLOT_PX

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[640px]">
        <div
          className="grid border-b border-border bg-muted/40"
          style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}
        >
          <div />
          {days.map(d => {
            const key = dayKey(d)
            const dayOutlook = outlookByDay.get(key) ?? []
            const allDay = dayOutlook.filter(e => e.isAllDay && !isBlock(e))
            const allDayBlocked = dayOutlook.some(e => e.isAllDay && isBlock(e))
            return (
              <div key={key} className="border-l border-border px-2 py-1.5 text-center">
                <span
                  className={cn(
                    'text-xs font-medium',
                    key === todayKey ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                </span>
                {allDayBlocked && (
                  <span
                    className="mt-0.5 block truncate rounded px-1 text-[10px] leading-4 text-muted-foreground"
                    style={{ backgroundImage: BLOCK_HATCH }}
                  >
                    Blocked all day
                  </span>
                )}
                {allDay.map(e => {
                  const style = CATEGORY_STYLE[categorize(e.subject)]
                  return (
                    <span
                      key={e.id}
                      className="mt-0.5 block truncate rounded px-1 text-[10px] leading-4"
                      style={{
                        background: style.bg,
                        color: style.text,
                        borderLeft: `3px solid ${style.dot}`,
                      }}
                      title={`All day: ${e.subject} (${outlookSource(e)})`}
                    >
                      {e.subject}
                    </span>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
          <div className="relative" style={{ height: gridHeight }}>
            {Array.from({ length: slotCount }, (_, i) => {
              const minutes = gridStartMin + i * SLOT_MIN
              return minutes % 60 === 0 ? (
                <span
                  key={i}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground"
                  style={{ top: i * SLOT_PX }}
                >
                  {fmtGridHour(minutes)}
                </span>
              ) : null
            })}
          </div>
          {days.map(d => {
            const key = dayKey(d)
            const events = (byDay.get(key) ?? []).filter(a => a.status !== 'cancelled')
            const timed = (outlookByDay.get(key) ?? []).filter(e => !e.isAllDay)
            const blocks = timed.filter(isBlock)
            const outlookTimed = timed.filter(e => !isBlock(e))
            return (
              <div
                key={key}
                className={cn('relative border-l border-border', key === todayKey && 'bg-primary/5')}
                style={{ height: gridHeight }}
              >
                {Array.from({ length: slotCount }, (_, i) => {
                  const minutes = gridStartMin + i * SLOT_MIN
                  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
                  const mm = String(minutes % 60).padStart(2, '0')
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Book ${key} ${hh}:${mm}`}
                      onClick={() => onSlotClick(d, `${hh}:${mm}`)}
                      className={cn(
                        'absolute inset-x-0 hover:bg-primary/5',
                        minutes % 60 === 0 ? 'border-t border-border' : 'border-t border-border/40',
                      )}
                      style={{ top: i * SLOT_PX, height: SLOT_PX }}
                    />
                  )
                })}
                {blocks.map(e => {
                  const startMin = Math.max(minutesOfDay(e.startIso), gridStartMin)
                  const endMin = Math.min(
                    Math.max(endMinutesOfDay(e.startIso, e.endIso), startMin + 15),
                    gridEndMin,
                  )
                  if (startMin >= gridEndMin) return null
                  const top = ((startMin - gridStartMin) / SLOT_MIN) * SLOT_PX
                  const height = Math.max(((endMin - startMin) / SLOT_MIN) * SLOT_PX, 18)
                  return (
                    <div
                      key={e.id}
                      className="pointer-events-none absolute inset-x-0.5 rounded"
                      style={{ top, height, backgroundImage: BLOCK_HATCH }}
                      title={`${fmtTime(e.startIso)}–${fmtTime(e.endIso)} ${e.subject} (blocked)`}
                    />
                  )
                })}
                {outlookTimed.map(e => {
                  const startMin = Math.max(minutesOfDay(e.startIso), gridStartMin)
                  const endMin = Math.min(
                    Math.max(endMinutesOfDay(e.startIso, e.endIso), startMin + 15),
                    gridEndMin,
                  )
                  if (startMin >= gridEndMin) return null
                  const top = ((startMin - gridStartMin) / SLOT_MIN) * SLOT_PX
                  const height = Math.max(((endMin - startMin) / SLOT_MIN) * SLOT_PX, 18)
                  const style = CATEGORY_STYLE[categorize(e.subject)]
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        'pointer-events-none absolute inset-x-1 overflow-hidden rounded px-1.5 py-0.5',
                        (e.showAs === 'free' || e.showAs === 'tentative') && 'opacity-60',
                      )}
                      style={{
                        top,
                        height,
                        background: style.bg,
                        color: style.text,
                        borderLeft: `3px solid ${style.dot}`,
                      }}
                      title={`${fmtTime(e.startIso)}–${fmtTime(e.endIso)} ${e.subject} (${outlookSource(e)})`}
                    >
                      <span className="block truncate text-[11px] leading-4">
                        {fmtTime(e.startIso)} {e.subject}
                      </span>
                    </div>
                  )
                })}
                {events.map(a => {
                  const startMin = Math.max(minutesOfDay(a.startTime), gridStartMin)
                  const endMin = Math.min(
                    Math.max(endMinutesOfDay(a.startTime, a.endTime), startMin + 15),
                    gridEndMin,
                  )
                  if (startMin >= gridEndMin) return null
                  const top = ((startMin - gridStartMin) / SLOT_MIN) * SLOT_PX
                  const height = Math.max(((endMin - startMin) / SLOT_MIN) * SLOT_PX, 20)
                  const style = CATEGORY_STYLE[categorize(a.typeLabel)]
                  const matterChip = a.linkedMatterNumber
                    ? shortMatterLabel(a.linkedMatterNumber)
                    : null
                  // A sub-90-minute event only fits two lines; the matter chip
                  // is more useful there than repeating the type label.
                  const showTypeLabel = !matterChip || endMin - startMin >= 90
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onEventClick(a)}
                      className="absolute inset-x-1 overflow-hidden rounded px-1.5 py-0.5 text-left hover:brightness-95"
                      style={{
                        top,
                        height,
                        background: style.bg,
                        color: style.text,
                        borderLeft: `3px solid ${style.dot}`,
                      }}
                      title={`${fmtTime(a.startTime)}–${fmtTime(a.endTime)} ${a.typeLabel} — ${a.attendeeName}`}
                    >
                      <span className="block truncate text-[11px] font-medium leading-4">
                        {fmtTime(a.startTime)} {a.attendeeName}
                      </span>
                      <span
                        className={cn('mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px]', availabilityClass(a))}
                      >
                        {availabilityLabel(a)}
                      </span>
                      {showTypeLabel && (
                        <span className="block truncate text-[10px] leading-4 opacity-80">
                          {a.typeLabel}
                        </span>
                      )}
                      {matterChip && (
                        <span className="mt-0.5 inline-block max-w-full truncate rounded-full border border-navy-12 bg-background/80 px-1.5 text-[9px] font-medium text-foreground">
                          ↗ {matterChip}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
