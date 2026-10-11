'use client'

import { calendarAnchorDate } from '@/lib/calendarDay'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCalendarNavigation, shortcutBlocked } from './useCalendarNavigation'
import { useCalendarClock } from './useCalendarClock'
import { firmTodayKey } from '@/lib/firmDate'
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
import { externalSourceLabel, isExternallyManagedSource } from '@/lib/appointments/types'
import { CalendarVisibilityPopover } from './CalendarVisibilityPopover'
import { NextUp, WeekStrip } from './CalendarPanels'
import { dateInstant, nextDateKey } from '@/lib/calendarAvailability'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { DayAvailability } from './types'
import { DayAgenda } from './DayAgenda'
import { EventPrepDrawer } from './EventPrepDrawer'
import { PlanView } from './PlanView'
import { QuickBookPopover } from './QuickBookPopover'
import {
  type AttentionItem,
  type BookableType,
  type CalendarAppointment,
  type CalendarRailData,
  type ExternalCalendarRef,
  type ExternalCalendarEvent,
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
import { formatPlanHeading, formatSpanHeading, instantDayKey, zonedTimeInput } from './calendarTime'
import { TimeGrid } from './WeekTimeGrid'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtTime(iso: string, timezone = FIRM_TIMEZONE): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
}

/** Names the calendar an event came from, for tooltips. */
function calendarSource(event: ExternalCalendarEvent): string {
  return event.calendarName ? `Google · ${event.calendarName}` : 'Google Calendar'
}

/** Busy is the default. Only exceptions get a chip. */
function exceptionLabel(appointment: CalendarAppointment): string | null {
  if (appointment.status === 'no_show') return 'No-show'
  if (appointment.status === 'cancelled') return 'Cancelled'
  if (appointment.status === 'rescheduled') return 'Rescheduled'
  if (appointment.calendarShowAsBusy === false) return 'Free'
  return null
}

function fmtDayHeading(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
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
}

function parseIntOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Key calendar events by day. Timed events use the local start day; all-day
 * events use the UTC date parts (Graph reports them as UTC midnights) and
 * expand across each day they span.
 */
function calendarEventsByDay(events: ExternalCalendarEvent[], timezone: string): Map<string, ExternalCalendarEvent[]> {
  const map = new Map<string, ExternalCalendarEvent[]>()
  const push = (key: string, e: ExternalCalendarEvent) => {
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
      for (let key = instantDayKey(e.startIso, timezone); key <= instantDayKey(new Date(Date.parse(e.endIso) - 1).toISOString(), timezone); key = nextDateKey(key)) push(key, e)
    }
  }
  return map
}

export function CalendarClient({ initialDay }: { initialDay?: string | null } = {}) {
  const [timezone, setTimezone] = useState(FIRM_TIMEZONE)
  const token = useAccessToken()
  const now = useCalendarClock()
  const today = calendarAnchorDate(firmTodayKey(now), now)
  const navigation = useCalendarNavigation(initialDay, timezone)
  const { view, anchor, selectedDay } = navigation
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const updateNavigation = navigation.update
  const setSelectedDay = useCallback((key: string) => updateNavigation(view, calendarAnchorDate(key, anchor), key), [updateNavigation, view, anchor])
  const setAnchor = useCallback((value: Date | ((current: Date) => Date)) => {
    const next = typeof value === 'function' ? value(anchor) : value
    updateNavigation(view, next)
  }, [updateNavigation, view, anchor])
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([])
  const [types, setTypes] = useState<BookableType[]>([])
  const [loading, setLoading] = useState(true)
  const [quickBookOpen, setQuickBookOpen] = useState(false)
  const [quickBookPrefill, setQuickBookPrefill] = useState<string | null>(null)
  const [reschedule, setReschedule] = useState<RescheduleDraft | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const showCalendar = true
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [discoveryUnavailable, setDiscoveryUnavailable] = useState(false)
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([])
  const [calendarEvents, setCalendarEvents] = useState<ExternalCalendarEvent[]>([])
  const [calendarConnected, setCalendarConnected] = useState(true)
  const [accountCalendars, setAccountCalendars] = useState<ExternalCalendarRef[]>([])
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<string[]>([])
  const [calendarTruncated, setCalendarTruncated] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [calendarSkipped, setCalendarSkipped] = useState<string[]>([])
  const [attentionUnavailable, setAttentionUnavailable] = useState(false)
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [availability, setAvailability] = useState<DayAvailability | null>(null)
  const [availabilityState, setAvailabilityState] = useState('loading')
  const [workload, setWorkload] = useState<PlanData['days']>([])
  const [rail, setRail] = useState<CalendarRailData>({ datesThisWeek: [], followUps: [], openSlots: [] })
  const [planData, setPlanData] = useState<PlanData | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null)
  const [previewEvents, setPreviewEvents] = useState<ExternalCalendarEvent[]>([])
  const [planBlock, setPlanBlock] = useState<PlanBlockDraft | null>(null)
  const [planBlockSubmitting, setPlanBlockSubmitting] = useState(false)
  const [googleStatus, setGoogleStatus] = useState<'loading' | 'included' | 'unavailable' | 'partial'>('loading')
  const [planState, setPlanState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cornerstone.calendar.hidden-categories') ?? '[]')
      if (Array.isArray(saved)) setHiddenCategories(saved.filter(value => [...CATEGORY_LEGEND.map(item => item.category), 'blocked'].includes(value)))
    } catch { /* Optional local preferences. */ }
  }, [])
  function toggleCategory(category: string) {
    const next = hiddenCategories.includes(category) ? hiddenCategories.filter(value => value !== category) : [...hiddenCategories, category]
    setHiddenCategories(next)
    try { localStorage.setItem('cornerstone.calendar.hidden-categories', JSON.stringify(next)) } catch { /* Optional local preferences. */ }
  }

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const range = useMemo((): { from: Date; to: Date } => {
    if (view === 'day') { const from = startOfWeek(anchor); return { from, to: addDays(from, 7) } }
    if (view === 'week') {
      const from = startOfWeek(anchor)
      return { from, to: addDays(from, 7) }
    }
    if (view === 'plan') return { from: startOfDay(anchor), to: addDays(anchor, 16) }
    const grid = monthGrid(anchor.getFullYear(), anchor.getMonth())
    return { from: grid[0], to: addDays(grid[41], 1) }
  }, [view, anchor])

  const loadSequence = useRef(0)
  const load = useCallback(async () => {
    if (!navigation.ready) return
    const sequence = ++loadSequence.current
    setLoading(true)
    const rangeQuery = `from=${new Date(dateInstant(dayKey(range.from), timezone)).toISOString()}&to=${new Date(dateInstant(dayKey(range.to), timezone)).toISOString()}`
    try {
      const [apptRes, calendarRes] = await Promise.all([
        fetch(`/api/admin/scheduling/appointments?${rangeQuery}`, { headers: authHeaders() }),
        showCalendar
          ? fetch(`/api/admin/scheduling/calendar-events?${rangeQuery}`, { headers: authHeaders() })
          : Promise.resolve(null),
      ])
      if (sequence !== loadSequence.current) return
      if (!apptRes.ok) {
        toast.error('Failed to load appointments')
        return
      }
      const json = await apptRes.json()
      if (sequence !== loadSequence.current) return
      setTypes((json.types ?? []).filter((t: BookableType) => t.active))
      let appointmentRows: CalendarAppointment[] = json.appointments ?? []
      if (calendarRes) {
        const calendarJson = calendarRes.ok
          ? await calendarRes.json()
          : { connected: false, events: [], calendars: [], truncated: false }
        if (sequence !== loadSequence.current) return
        setCalendarEvents(calendarJson.events ?? [])
        setCalendarConnected(Boolean(calendarJson.connected))
        setCalendarTruncated(Boolean(calendarJson.truncated))
        setCalendarSkipped(calendarJson.skipped ?? [])
        setCalendarError(
          calendarRes.ok
            ? (typeof calendarJson.error === 'string' ? calendarJson.error : null)
            : `Calendar request failed (${calendarRes.status})`,
        )
        // The calendar fetch also mirrors calendar-side moves and deletions back
        // onto the appointment rows. Those writes land after the parallel
        // appointments read, so re-read once when anything actually changed.
        const synced = calendarJson.synced as { moved?: number; cancelled?: number } | undefined
        const changed = (synced?.moved ?? 0) + (synced?.cancelled ?? 0)
        if (changed > 0) {
          const resyncRes = await fetch(`/api/admin/scheduling/appointments?${rangeQuery}`, {
            headers: authHeaders(),
          })
          if (resyncRes.ok) {
            appointmentRows = (await resyncRes.json()).appointments ?? appointmentRows
            if (sequence !== loadSequence.current) return
          }
          toast.info(
            `Synced ${changed} appointment${changed === 1 ? '' : 's'} from Google Calendar`,
          )
        }
      } else {
        setCalendarEvents([])
        setCalendarTruncated(false)
        setCalendarSkipped([])
        setCalendarError(null)
      }
      if (sequence === loadSequence.current) setAppointments(appointmentRows)
    } catch {
      if (sequence === loadSequence.current) toast.error('Failed to load appointments')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [range, authHeaders, showCalendar, navigation.ready, timezone])

  useEffect(() => {
    setAppointments([])
    setCalendarEvents([])
    void load()
    return () => { loadSequence.current += 1 }
  }, [load])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [calendarsRes, settingsRes] = await Promise.all([
          fetch('/api/admin/scheduling/calendars', { headers: authHeaders() }),
          fetch('/api/admin/scheduling/settings', { headers: authHeaders() }),
        ])
        if (cancelled) return
        if (!calendarsRes.ok || !settingsRes.ok) { setDiscoveryUnavailable(true); setDiscoveryLoading(false); return }
        setDiscoveryUnavailable(false)
        setDiscoveryLoading(false)
        const calendarsJson = await calendarsRes.json()
        const settingsJson = await settingsRes.json()
        if (cancelled) return
        setAccountCalendars(calendarsJson.calendars ?? [])
        setHiddenCalendarIds(settingsJson.settings?.hiddenCalendarIds ?? [])
        setTimezone(settingsJson.settings?.timezone ?? FIRM_TIMEZONE)
      } catch {
        if (!cancelled) { setDiscoveryUnavailable(true); setDiscoveryLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [authHeaders])

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
        updateNavigation(view, calendarAnchorDate(instantDayKey(ghosts[0].startIso, timezone), anchor))
      }
    }
    window.addEventListener('calendar:preview-proposals', handler)
    return () => window.removeEventListener('calendar:preview-proposals', handler)
  }, [updateNavigation, view, timezone, anchor])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>()
    for (const a of appointments) {
      for (let key = instantDayKey(a.startTime, timezone); key <= instantDayKey(new Date(Date.parse(a.endTime) - 1).toISOString(), timezone); key = nextDateKey(key)) {
        const list = map.get(key) ?? []
        list.push(a)
        map.set(key, list)
      }
    }
    return map
  }, [appointments, timezone])

  const calendarByDay = useMemo(
    () => calendarEventsByDay(showCalendar ? [...calendarEvents, ...previewEvents] : previewEvents, timezone),
    [calendarEvents, previewEvents, showCalendar, timezone],
  )

  const visibleByDay = useMemo(() => new Map([...byDay].map(([key, rows]) => [key, rows.filter(row => !hiddenCategories.includes(categorize(row.typeLabel)))])), [byDay, hiddenCategories])
  const visibleCalendarByDay = useMemo(() => new Map([...calendarByDay].map(([key, rows]) => [key, rows.filter(row => !hiddenCategories.includes(isBlock(row) ? 'blocked' : categorize(row.subject)))])), [calendarByDay, hiddenCategories])

  function shift(delta: number) {
    if (view === 'month') {
      setAnchor(a => new Date(a.getFullYear(), a.getMonth() + delta, 1))
    } else if (view === 'day') {
      // The day view renders from selectedDay, not anchor, so move both.
      const next = addDays(selectedDate, delta)
      navigation.update(view, next)
    } else {
      setAnchor(a => addDays(a, delta * (view === 'week' ? 7 : 1)))
    }
  }

  function openQuickBook(prefill?: { date?: Date; time?: string; iso?: string }) {
    let iso = prefill?.iso ?? null
    if (!iso && prefill?.date) {
      const time = prefill.time ?? '09:00'
      iso = new Date(dateInstant(toDateInputValue(prefill.date), timezone, time)).toISOString()
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
        ? formatSpanHeading(startOfWeek(anchor), addDays(startOfWeek(anchor), 6))
        : view === 'plan'
          ? formatPlanHeading(selectedDay, timezone)
          : fmtDayHeading(anchor)

  const todayKey = instantDayKey(now.toISOString(), timezone)
  const selectedAppointments = byDay.get(selectedDay) ?? []
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [selectedDay])

  const selectedCalendarEvents = calendarByDay.get(selectedDay) ?? []

  useEffect(() => {
    if ((view !== 'day' && view !== 'week') || !navigation.ready) return
    const controller = new AbortController()
    setAttention([])
    setAttentionUnavailable(false)
    setRail({ datesThisWeek: [], followUps: [], openSlots: [] })
    setAvailability(null)
    setAvailabilityState('loading')
    void (async () => {
      try {
        const firstType = types[0]
        const slotParams = firstType ? new URLSearchParams({ typeId: firstType.id, locationType: allowedFormats(firstType)[0], from: new Date(dateInstant(selectedDay, timezone)).toISOString(), to: new Date(dateInstant(nextDateKey(selectedDay), timezone)).toISOString() }) : null
        const [attentionResponse, availableResponse, slotsResponse] = await Promise.all([
          fetch(`/api/admin/calendar/attention?date=${selectedDay}`, { headers: authHeaders(), signal: controller.signal }),
          fetch(`/api/admin/calendar/availability?date=${selectedDay}`, { headers: authHeaders(), signal: controller.signal }),
          slotParams ? fetch(`/api/admin/scheduling/slots?${slotParams}`, { headers: authHeaders(), signal: controller.signal }) : Promise.resolve(null),
        ])
        const [body, available, slots] = await Promise.all([
          attentionResponse.ok ? attentionResponse.json() : null,
          availableResponse.ok ? availableResponse.json() : null,
          slotsResponse?.ok ? slotsResponse.json() : null,
        ])
        if (controller.signal.aborted) return
        setAttentionUnavailable(!body)
        setAttention(body?.items ?? [])
        setRail({ ...(body?.rail ?? { datesThisWeek: [], followUps: [] }), openSlots: slots?.connected ? slots.slots ?? [] : [] })
        setAvailability(available?.connected ? available : null)
        setAvailabilityState(slots?.connected ? 'ready' : 'unavailable')
      } catch {
        if (!controller.signal.aborted) { setAvailabilityState('unavailable'); setAttentionUnavailable(true) }
      }
    })()
    return () => controller.abort()
  }, [view, selectedDay, types, authHeaders, timezone, navigation.ready, appointments])

  const weekFrom = dayKey(startOfWeek(anchor))
  useEffect(() => {
    if ((view !== 'day' && view !== 'week') || !navigation.ready) return
    const controller = new AbortController()
    setWorkload([])
    setGoogleStatus('loading')
    void fetch(`/api/admin/calendar/plan?from=${weekFrom}&to=${nextDateKey(weekFrom, 7)}&workload=1`, { headers: authHeaders(), signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (controller.signal.aborted) return
        const status = body?.googleStatus === 'included' || body?.googleStatus === 'unavailable' || body?.googleStatus === 'partial'
          ? body.googleStatus
          : body?.connected ? 'included' : 'partial'
        setGoogleStatus(body ? status : 'unavailable')
        setWorkload(!body || status === 'partial' ? [] : body.days ?? [])
      })
      .catch(() => { if (!controller.signal.aborted) setGoogleStatus('unavailable') })
    return () => controller.abort()
  }, [weekFrom, view, authHeaders, navigation.ready, appointments])

  useEffect(() => {
    if (view !== 'plan') return
    let stale = false
    setPlanData(null)
    setPlanState('loading')
    void fetch(`/api/admin/calendar/plan?from=${encodeURIComponent(`${selectedDay}T12:00:00.000Z`)}`, { headers: authHeaders() })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then(body => { if (!stale) { setPlanData(body); setPlanState('ready') } })
      .catch(() => { if (!stale) { setPlanData(null); setPlanState('error') } })
    return () => { stale = true }
  }, [view, selectedDay, authHeaders])

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
    setReschedule({
      id: a.id,
      label: `${a.typeLabel} — ${a.attendeeName}`,
      date: instantDayKey(a.startTime, timezone),
      time: zonedTimeInput(a.startTime, timezone),
    })
  }

  function openPlanBlock(deadline: PlanData['deadlines'][number]) {
    const parsed = Number.isFinite(Date.parse(deadline.date)) ? deadline.date : null
    const date = parsed ? instantDayKey(parsed, timezone) : dayKey(selectedDate)
    const time = parsed ? zonedTimeInput(parsed, timezone) : '09:00'
    const durationMinutes = parseIntOrNull(`${deadline.durationMinutes}`) ?? 30

    setPlanBlock({
      id: deadline.id,
      date,
      time,
      title: deadline.label,
      durationMinutes: String(durationMinutes),
      showAsBusy: true,
    })
  }

  async function createPlanBlock() {
    if (!planBlock) return
    const durationMinutes = parseIntOrNull(planBlock.durationMinutes)
    const startMs = dateInstant(planBlock.date, timezone, planBlock.time)
    if (!durationMinutes) {
      toast.error('Block duration must be a positive number.')
      return
    }
    if (!Number.isFinite(startMs)) {
      toast.error('Add a valid date and time for the block.')
      return
    }
    setPlanBlockSubmitting(true)
    try {
      const response = await fetch(`/api/admin/tasks/${planBlock.id}/calendar-hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          startAt: new Date(startMs).toISOString(),
          durationMinutes,
          showAsBusy: planBlock.showAsBusy,
        }),
      })
      const json = await response.json().catch(() => ({})) as {
        error?: string
        hold?: { alreadyExists?: boolean }
      }
      if (!response.ok) {
        toast.error(json.error ?? 'Could not create that block')
        return
      }

      toast.success(json.hold?.alreadyExists
        ? 'This task already has an active calendar block'
        : 'Task added to the calendar without creating a duplicate')
      setPlanBlock(null)
      void load()
    } finally {
      setPlanBlockSubmitting(false)
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (shortcutBlocked(event)) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && key === 'k') {
        event.preventDefault()
        setQuickBookPrefill(null)
        setQuickBookOpen(open => !open)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const shortcuts = { d: 'day', w: 'week', m: 'month', p: 'plan' } as const
      if (key in shortcuts && !event.shiftKey) navigation.update(shortcuts[key as keyof typeof shortcuts], selectedDate, selectedDay, true)
      else if (key === 't' && !event.shiftKey) navigation.update(view, calendarAnchorDate(todayKey, today))
      else if (key === 'arrowleft' && !event.shiftKey) shift(-1)
      else if (key === 'arrowright' && !event.shiftKey) shift(1)
      else if (key === '?') setShortcutsOpen(true)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const panelAppointments = visibleByDay.get(selectedDay) ?? []
  const panelCalendarEvents = visibleCalendarByDay.get(selectedDay) ?? []
  const panelBlocks = panelCalendarEvents.filter(isBlock)

  const dayPanel = (
    <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">{fmtDayHeading(selectedDate)}</h2>
          {panelCalendarEvents.filter(e => !isBlock(e)).length > 0 && (
            <div className="mt-2 space-y-0.5">
              {panelCalendarEvents.filter(e => !isBlock(e)).map(e => (
                <p key={e.id} className="text-xs text-muted-foreground">
                  <span className="mr-1 rounded bg-muted px-1 py-0.5 text-micro uppercase">Calendar</span>
                  {e.isAllDay ? 'All day' : `${fmtTime(e.startIso)}–${fmtTime(e.endIso)}`} · {e.subject}
                </p>
              ))}
            </div>
          )}
          {panelAppointments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No appointments.</p>
          ) : (
            <div className="mt-2 divide-y divide-border">
              {panelAppointments.map(a => {
                const isPast = Date.parse(a.startTime) < now.getTime()
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
                          {exceptionLabel(a) && (
                            <span className={cn('ml-1 inline-block rounded-full px-1.5 py-0.5', a.calendarShowAsBusy === false && a.status === 'scheduled' ? 'bg-green-bg text-green' : 'bg-muted text-muted-foreground')}>
                              {exceptionLabel(a)}
                            </span>
                          )}
                          {isExternallyManagedSource(a.source) && (
                            <span className="ml-2 text-primary">{externalSourceLabel(a.source)}</span>
                          )}
                          {!isExternallyManagedSource(a.source) && !a.calendarSynced && a.status === 'scheduled' && (
                            <span className="ml-2 text-amber">⚠ not on the calendar</span>
                          )}
                        </p>
                        {a.bookingAnswers && a.bookingAnswers.length > 0 && (
                          <dl className="mt-1 space-y-0.5 text-xs">
                            {a.bookingAnswers.map(ans => (
                              <div key={ans.questionId || ans.label}>
                                <dt className="inline font-medium text-foreground">{ans.label}: </dt>
                                <dd className="inline whitespace-pre-line text-muted-foreground">{ans.answer}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
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
                    {a.status === 'scheduled' && !isExternallyManagedSource(a.source) && (
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
                    beginReschedule(a)
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
          {panelBlocks.length > 0 && (
            <p className="mt-3 text-micro text-muted-foreground">
              {panelBlocks
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(['day', 'week', 'month', 'plan'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  navigation.update(v, selectedDate, selectedDay, true)
                }}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  view === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v} <kbd className="ml-1 text-micro">{v[0].toUpperCase()}</kbd>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigation.update(view, calendarAnchorDate(todayKey, today))
            }}
          >
            Today <kbd className="ml-1 text-micro">T</kbd>
          </Button>
          <CalendarVisibilityPopover
            calendars={accountCalendars} hiddenIds={hiddenCalendarIds} authHeaders={authHeaders}
            connected={calendarConnected} error={calendarError} truncated={calendarTruncated}
            skipped={calendarSkipped} discoveryUnavailable={discoveryUnavailable} discoveryLoading={discoveryLoading}
            onChange={next => { setHiddenCalendarIds(next); void load() }}
          />
          <QuickBookPopover
            open={quickBookOpen}
            onOpenChange={setQuickBookOpen}
            types={types}
            prefillIso={quickBookPrefill}
            timezone={timezone}
            authHeaders={authHeaders}
            onBooked={() => void load()}
          />
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/settings?tab=scheduling" aria-label="Scheduling settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'items-center gap-2 overflow-x-auto text-micro text-foreground',
          // Month, week and day all colour events by category, so all three
          // need the key. Only the plan view has no coloured events.
          view !== 'plan' ? 'flex' : 'hidden',
        )}
      >
        {[...CATEGORY_LEGEND, { category: 'blocked', label: 'Blocked' }].map(({ category, label }) => {
          const hidden = hiddenCategories.includes(category)
          const count = category === 'blocked'
            ? calendarEvents.filter(isBlock).length
            : appointments.filter(item => item.status === 'scheduled' && categorize(item.typeLabel) === category).length + calendarEvents.filter(item => !isBlock(item) && categorize(item.subject) === category).length
          const style = category === 'blocked' ? null : CATEGORY_STYLE[category as keyof typeof CATEGORY_STYLE]
          return <button key={category} type="button" aria-pressed={!hidden} onClick={() => toggleCategory(category)}
            className={cn('shrink-0 rounded-full border border-border px-2.5 py-1 text-xs', hidden && 'line-through')}
            style={hidden ? undefined : { background: style?.bg, color: style?.text, backgroundImage: category === 'blocked' ? BLOCK_HATCH : undefined }}>
            {label} · {count}
          </button>
        })}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{appointments.filter(item => item.status === 'scheduled').length} appointments · {calendarEvents.filter(item => !isBlock(item)).length} calendar events · {view === 'month' ? 'this month' : 'this week'}</span>
      </div>

      {loading && <p className="text-xs text-muted-foreground" role="status">Loading calendar…</p>}
      <div className="flex flex-col items-start gap-3 xl:flex-row" aria-busy={loading}>
        <div className="min-w-0 flex-1">
          {view === 'month' ? (
            <MonthGrid
              anchor={anchor}
              byDay={visibleByDay}
              calendarByDay={visibleCalendarByDay}
              todayKey={todayKey}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onEventClick={setSelectedAppointment}
            />
          ) : view === 'week' ? (
            <div className="space-y-2">
            <WorkloadNote status={googleStatus} />
            <TimeGrid
              days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))}
              byDay={visibleByDay}
              calendarByDay={visibleCalendarByDay}
              todayKey={todayKey}
              now={now}
              timezone={timezone}
              workload={workload}
              appointmentCounts={new Map([...byDay].map(([key, rows]) => [key, rows.filter(a => a.status === 'scheduled').length]))}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onSlotClick={(date, time) => openQuickBook({ date, time })}
              onEventClick={setSelectedAppointment}
            />
            </div>
          ) : view === 'day' ? (
            <div className="space-y-3">
            <WeekStrip days={Array.from({ length: 7 }, (_, i) => { const date = nextDateKey(weekFrom, i); return workload.find(day => day.date === date) ?? { date, clientMinutes: 0, internalMinutes: 0, targetMinutes: NaN, isToday: date === todayKey } })} selectedDay={selectedDay} todayKey={todayKey} counts={new Map([...byDay].map(([key, rows]) => [key, rows.filter(a => a.status === 'scheduled').length]))} onSelect={setSelectedDay} />
            <WorkloadNote status={googleStatus} />
            <DayAgenda
              now={now} todayKey={todayKey} timezone={timezone} availability={availability} attentionUnavailable={attentionUnavailable}
              conflictAppointments={selectedAppointments} conflictCalendarEvents={selectedCalendarEvents}
              totalAppointments={selectedAppointments.filter(a => a.status === 'scheduled').length}
              totalCalendarEvents={selectedCalendarEvents.filter(e => !isBlock(e)).length}
              date={selectedDate}
              appointments={visibleByDay.get(selectedDay) ?? []}
              calendarEvents={visibleCalendarByDay.get(selectedDay) ?? []}
              attention={attention}
              rail={rail}
              onDismissAttention={id => void dismissAttention(id)}
              onOpenAppointment={setSelectedAppointment}
              onReschedule={beginReschedule}
              onBookSlot={iso => openQuickBook(iso ? { iso } : { date: selectedDate })}
            />
            </div>
          ) : (
              <PlanView
                data={planData}
                error={planState === 'error'}
                onBook={openPlanBlock}
                onAskAssistant={prompt => window.dispatchEvent(new CustomEvent('cornerstone:chat-open', { detail: { prompt } }))}
              />
            )}
        </div>
        {view === 'week' && <div className="w-full shrink-0 xl:w-[300px]"><NextUp date={selectedDay} todayKey={todayKey} now={now} appointments={selectedAppointments} visibleAppointments={panelAppointments} calendarEvents={panelCalendarEvents} attention={attention} attentionUnavailable={attentionUnavailable} slots={rail.openSlots.filter(slot => Date.parse(slot.startIso) >= now.getTime())} availabilityState={availabilityState} timezone={timezone} onDismiss={id => void dismissAttention(id)} onOpen={setSelectedAppointment} onBook={iso => openQuickBook({ iso })} /></div>}
      </div>

      {view === 'month' && dayPanel}

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent><DialogHeader><DialogTitle>Calendar shortcuts</DialogTitle></DialogHeader>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>D / W / M / P</dt><dd>Day / Week / Month / Plan</dd>
            <dt>T</dt><dd>Today</dd><dt>← / →</dt><dd>Previous / next period</dd>
            <dt>?</dt><dd>All shortcuts</dd><dt>⌘ / Ctrl + Shift + K</dt><dd>Quick book</dd>
          </dl>
        </DialogContent>
      </Dialog>
      <Dialog open={planBlock !== null} onOpenChange={open => !open && setPlanBlock(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Block calendar time</DialogTitle>
          </DialogHeader>
          {planBlock && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Add this existing task to the calendar. Its deadline will not change.</p>
              <div>
                <Label htmlFor="plan-block-title">Title</Label>
                <Input
                  id="plan-block-title"
                  className="mt-1"
                  value={planBlock.title}
                  readOnly
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
        timezone={timezone}
        onReschedule={beginReschedule}
        onAppointmentChanged={updated => {
          setSelectedAppointment(current => (current?.id === updated.id ? updated : current))
          setAppointments(rows => rows.map(row => (row.id === updated.id ? updated : row)))
        }}
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
                Moves the calendar event and emails the client the new time. Any free
                time works — client-facing hours and notice rules do not apply.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReschedule(null)} disabled={acting}>
                  Cancel
                </Button>
                <Button
                  disabled={acting}
                  onClick={() => {
                    const startMs = dateInstant(reschedule.date, timezone, reschedule.time)
                    if (!Number.isFinite(startMs)) {
                      toast.error('Invalid date or time')
                      return
                    }
                    void patchAppointment(
                      {
                        appointmentId: reschedule.id,
                        action: 'reschedule',
                        newStartIso: new Date(startMs).toISOString(),
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

function WorkloadNote({ status }: { status: 'loading' | 'included' | 'unavailable' | 'partial' }) {
  if (status === 'unavailable') return <p className="text-xs text-muted-foreground">Load counts Cornerstone appointments. Google Calendar is not included.</p>
  if (status === 'partial') return <p className="text-xs text-muted-foreground">Load is hidden because Google Calendar returned a partial result.</p>
  return null
}

function MonthGrid(props: {
  anchor: Date
  byDay: Map<string, CalendarAppointment[]>
  calendarByDay: Map<string, ExternalCalendarEvent[]>
  todayKey: string
  selectedDay: string
  onSelectDay: (key: string) => void
  onEventClick: (appointment: CalendarAppointment) => void
}) {
  const { anchor, byDay, calendarByDay, todayKey, selectedDay, onSelectDay, onEventClick } = props
  const grid = monthGrid(anchor.getFullYear(), anchor.getMonth())

  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted">
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
          const allCalendarEvents = calendarByDay.get(key) ?? []
          // Blocks collapse to one strip so they don't eat the three event slots.
          const blocks = allCalendarEvents.filter(isBlock)
          const dayCalendarEvents = allCalendarEvents.filter(e => !isBlock(e))
          const blockLabel = blocks.some(b => b.isAllDay) ? 'Blocked all day' : 'Blocked'
          const shown = dayAppointments.slice(0, 3)
          const calendarShown = dayCalendarEvents.slice(0, Math.max(0, 3 - shown.length))
          const hiddenCount =
            dayAppointments.length - shown.length + dayCalendarEvents.length - calendarShown.length
          return (
            <div
              key={key}
              onClick={() => onSelectDay(key)}
              className={cn(
                'flex min-h-24 flex-col items-stretch gap-1 border-border p-1.5 text-left align-top transition-colors',
                i % 7 !== 0 && 'border-l',
                i >= 7 && 'border-t',
                !inMonth && 'bg-muted',
                key === selectedDay ? 'bg-selected ring-1 ring-inset ring-selected-border' : 'hover:bg-accent',
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
                  className="truncate rounded px-1 text-micro leading-4 text-muted-foreground"
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
                      'truncate rounded px-1 py-0.5 text-left text-micro leading-4',
                      a.status !== 'scheduled' && 'bg-muted text-muted-foreground',
                      a.status === 'cancelled' && 'line-through',
                    )}
                    style={
                      a.status === 'cancelled'
                        ? undefined
                        : { background: style.bg, color: style.text, borderLeft: `3px solid ${style.dot}` }
                    }
                    title={`${fmtTime(a.startTime)} ${a.typeLabel} — ${a.attendeeName}`}
                  >
                    {fmtTime(a.startTime)} {a.attendeeName}
                    {exceptionLabel(a) ? ` · ${exceptionLabel(a)}` : ''}
                  </button>
                )
              })}
              {calendarShown.map(e => {
                const style = CATEGORY_STYLE[categorize(e.subject)]
                return (
                  <span
                    key={e.id}
                    className="truncate rounded px-1 py-0.5 text-micro leading-4"
                    style={{ background: style.bg, color: style.text, borderLeft: `3px solid ${style.dot}` }}
                    title={`${e.isAllDay ? 'All day' : fmtTime(e.startIso)} ${e.subject} (${calendarSource(e)})`}
                  >
                    {e.isAllDay ? '◦' : fmtTime(e.startIso)} {e.subject}
                  </span>
                )
              })}
              {hiddenCount > 0 && (
                <span className="px-1 text-micro text-muted-foreground">+{hiddenCount} more</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
