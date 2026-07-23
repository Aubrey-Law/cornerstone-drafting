'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Plus, Settings } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type LocationType = 'phone' | 'teams' | 'in_person'

const LOCATION_LABEL: Record<LocationType, string> = {
  phone: 'Phone call',
  teams: 'Virtual meeting',
  in_person: 'In person',
}

interface CalendarAppointment {
  id: string
  startTime: string
  endTime: string
  status: 'scheduled' | 'cancelled' | 'rescheduled' | 'no_show'
  locationType: LocationType | null
  secondAttendeeName: string | null
  secondAttendeeEmail: string | null
  attendeeName: string
  attendeeEmail: string
  attendeePhone: string | null
  notes: string | null
  typeLabel: string
  source: string
  outlookSynced: boolean
  linkedMatterId: string | null
  linkedLeadId: string | null
}

interface BookableType {
  id: string
  label: string
  durationMinutes: number
  locationType: LocationType
  locationTypes: LocationType[]
  active: boolean
}

function allowedFormats(type: BookableType | undefined): LocationType[] {
  if (!type) return ['phone']
  return type.locationTypes.length > 0 ? type.locationTypes : [type.locationType]
}

type CalendarView = 'month' | 'week' | 'day'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Time-grid bounds for day/week views (minutes from midnight, local). */
const GRID_START_MIN = 7 * 60
const GRID_END_MIN = 19 * 60
const SLOT_MIN = 30
const SLOT_PX = 40

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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

/** Minutes from local midnight for an ISO instant. */
function minutesOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

interface BookingDraft {
  typeId: string
  locationType: LocationType
  date: string
  time: string
  attendeeName: string
  attendeeEmail: string
  attendeePhone: string
  secondAttendeeName: string
  secondAttendeeEmail: string
  notes: string
}

interface RescheduleDraft {
  id: string
  label: string
  date: string
  time: string
}

export function CalendarClient() {
  const token = useAccessToken()
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState<CalendarView>('month')
  const [anchor, setAnchor] = useState<Date>(startOfDay(today))
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([])
  const [types, setTypes] = useState<BookableType[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string>(dayKey(today))
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const [booking, setBooking] = useState(false)
  const [reschedule, setReschedule] = useState<RescheduleDraft | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)

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
    const grid = monthGrid(anchor.getFullYear(), anchor.getMonth())
    return { from: grid[0], to: addDays(grid[41], 1) }
  }, [view, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/scheduling/appointments?from=${range.from.toISOString()}&to=${range.to.toISOString()}`,
        { headers: authHeaders() },
      )
      if (!res.ok) {
        toast.error('Failed to load appointments')
        return
      }
      const json = await res.json()
      setAppointments(json.appointments ?? [])
      setTypes((json.types ?? []).filter((t: BookableType) => t.active))
    } catch {
      toast.error('Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }, [range, authHeaders])

  useEffect(() => {
    void load()
  }, [load])

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

  function shift(delta: number) {
    if (view === 'month') {
      setAnchor(a => new Date(a.getFullYear(), a.getMonth() + delta, 1))
    } else {
      setAnchor(a => addDays(a, delta * (view === 'week' ? 7 : 1)))
    }
  }

  function openBookingDialog(prefill?: { date?: Date; time?: string }) {
    const date = prefill?.date ?? startOfDay(today)
    setDraft({
      typeId: types[0]?.id ?? '',
      locationType: allowedFormats(types[0])[0],
      date: toDateInputValue(date),
      time: prefill?.time ?? '09:00',
      attendeeName: '',
      attendeeEmail: '',
      attendeePhone: '',
      secondAttendeeName: '',
      secondAttendeeEmail: '',
      notes: '',
    })
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

  async function submitBooking() {
    if (!draft) return
    if (!draft.typeId || !draft.attendeeName.trim() || !draft.attendeeEmail.trim()) {
      toast.error('Type, name, and email are required')
      return
    }
    const start = new Date(`${draft.date}T${draft.time}`)
    if (!Number.isFinite(start.getTime())) {
      toast.error('Invalid date or time')
      return
    }
    setBooking(true)
    try {
      const res = await fetch('/api/admin/scheduling/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          typeId: draft.typeId,
          locationType: draft.locationType,
          startIso: start.toISOString(),
          attendeeName: draft.attendeeName.trim(),
          attendeeEmail: draft.attendeeEmail.trim(),
          attendeePhone: draft.attendeePhone.trim() || undefined,
          secondAttendeeName: draft.secondAttendeeName.trim() || undefined,
          secondAttendeeEmail: draft.secondAttendeeEmail.trim() || undefined,
          notes: draft.notes.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to book the appointment')
        return
      }
      toast.success('Appointment booked — confirmation email sent')
      setSelectedDay(draft.date)
      setDraft(null)
      void load()
    } catch {
      toast.error('Failed to book the appointment')
    } finally {
      setBooking(false)
    }
  }

  const heading =
    view === 'month'
      ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${startOfWeek(anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addDays(startOfWeek(anchor), 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : fmtDayHeading(anchor)

  const todayKey = dayKey(today)
  const selectedAppointments = byDay.get(selectedDay) ?? []
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [selectedDay])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(['month', 'week', 'day'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
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
          <Button size="sm" onClick={() => openBookingDialog({ date: selectedDate })}>
            <Plus className="mr-1 h-4 w-4" />
            New appointment
          </Button>
          <Button asChild variant="ghost" size="sm" title="Scheduling settings">
            <Link href="/admin/settings?tab=scheduling">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className={cn(loading && 'opacity-60')}>
        {view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            byDay={byDay}
            todayKey={todayKey}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        ) : (
          <TimeGrid
            days={
              view === 'week'
                ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
                : [startOfDay(anchor)]
            }
            byDay={byDay}
            todayKey={todayKey}
            onSlotClick={(date, time) => openBookingDialog({ date, time })}
            onEventClick={a => setSelectedDay(dayKey(new Date(a.startTime)))}
          />
        )}
      </div>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{fmtDayHeading(selectedDate)}</h2>
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
                        {!a.outlookSynced && a.status === 'scheduled' && (
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
                      <Link href={`/admin/leads/${a.linkedLeadId}`} className="text-xs text-primary underline">
                        View lead
                      </Link>
                    ) : null}
                  </div>
                  {a.status === 'scheduled' && (
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
      </section>

      <Dialog open={draft !== null} onOpenChange={open => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New appointment</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="book-type">Appointment type</Label>
                <select
                  id="book-type"
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={draft.typeId}
                  onChange={e => {
                    const next = types.find(t => t.id === e.target.value)
                    setDraft({
                      ...draft,
                      typeId: e.target.value,
                      // Keep the format if the new type also offers it.
                      locationType: allowedFormats(next).includes(draft.locationType)
                        ? draft.locationType
                        : allowedFormats(next)[0],
                    })
                  }}
                >
                  {types.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.durationMinutes} min)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="book-format">Meeting format</Label>
                <select
                  id="book-format"
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={draft.locationType}
                  onChange={e => setDraft({ ...draft, locationType: e.target.value as LocationType })}
                >
                  {allowedFormats(types.find(t => t.id === draft.typeId)).map(f => (
                    <option key={f} value={f}>
                      {LOCATION_LABEL[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="book-date">Date</Label>
                  <Input
                    id="book-date"
                    className="mt-1"
                    type="date"
                    value={draft.date}
                    onChange={e => setDraft({ ...draft, date: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="book-time">Time</Label>
                  <Input
                    id="book-time"
                    className="mt-1"
                    type="time"
                    value={draft.time}
                    onChange={e => setDraft({ ...draft, time: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="book-name">Client name</Label>
                <Input
                  id="book-name"
                  className="mt-1"
                  value={draft.attendeeName}
                  onChange={e => setDraft({ ...draft, attendeeName: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="book-spouse-name">Spouse name (optional)</Label>
                  <Input
                    id="book-spouse-name"
                    className="mt-1"
                    value={draft.secondAttendeeName}
                    onChange={e => setDraft({ ...draft, secondAttendeeName: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="book-spouse-email">Spouse email (optional)</Label>
                  <Input
                    id="book-spouse-email"
                    className="mt-1"
                    type="email"
                    value={draft.secondAttendeeEmail}
                    onChange={e => setDraft({ ...draft, secondAttendeeEmail: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="book-email">Email</Label>
                  <Input
                    id="book-email"
                    className="mt-1"
                    type="email"
                    value={draft.attendeeEmail}
                    onChange={e => setDraft({ ...draft, attendeeEmail: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="book-phone">Phone (optional)</Label>
                  <Input
                    id="book-phone"
                    className="mt-1"
                    value={draft.attendeePhone}
                    onChange={e => setDraft({ ...draft, attendeePhone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="book-notes">Notes (optional)</Label>
                <Textarea
                  id="book-notes"
                  className="mt-1"
                  rows={2}
                  value={draft.notes}
                  onChange={e => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Books on your Outlook calendar and emails the client a confirmation.
                Staff bookings can use any time that is free — client-facing hours and
                notice rules do not apply.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)} disabled={booking}>
                  Cancel
                </Button>
                <Button onClick={() => void submitBooking()} disabled={booking}>
                  {booking ? 'Booking…' : 'Book appointment'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
  todayKey: string
  selectedDay: string
  onSelectDay: (key: string) => void
}) {
  const { anchor, byDay, todayKey, selectedDay, onSelectDay } = props
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
          const shown = dayAppointments.slice(0, 3)
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(key)}
              className={cn(
                'flex min-h-24 flex-col items-stretch gap-1 border-border p-1.5 text-left align-top transition-colors',
                i % 7 !== 0 && 'border-l',
                i >= 7 && 'border-t',
                !inMonth && 'bg-muted/30',
                key === selectedDay ? 'bg-primary/5 ring-1 ring-inset ring-primary' : 'hover:bg-muted/50',
              )}
            >
              <span
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
              </span>
              {shown.map(a => (
                <span
                  key={a.id}
                  className={cn(
                    'truncate rounded px-1 py-0.5 text-[11px] leading-4',
                    a.status === 'cancelled'
                      ? 'bg-muted text-muted-foreground line-through'
                      : 'bg-primary/10 text-foreground',
                  )}
                  title={`${fmtTime(a.startTime)} ${a.typeLabel} — ${a.attendeeName}`}
                >
                  {fmtTime(a.startTime)} {a.attendeeName}
                </span>
              ))}
              {dayAppointments.length > shown.length && (
                <span className="px-1 text-[11px] text-muted-foreground">
                  +{dayAppointments.length - shown.length} more
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TimeGrid(props: {
  days: Date[]
  byDay: Map<string, CalendarAppointment[]>
  todayKey: string
  onSlotClick: (date: Date, time: string) => void
  onEventClick: (a: CalendarAppointment) => void
}) {
  const { days, byDay, todayKey, onSlotClick, onEventClick } = props
  const slotCount = (GRID_END_MIN - GRID_START_MIN) / SLOT_MIN
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
              </div>
            )
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
          <div className="relative" style={{ height: gridHeight }}>
            {Array.from({ length: slotCount }, (_, i) => {
              const minutes = GRID_START_MIN + i * SLOT_MIN
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
            return (
              <div key={key} className="relative border-l border-border" style={{ height: gridHeight }}>
                {Array.from({ length: slotCount }, (_, i) => {
                  const minutes = GRID_START_MIN + i * SLOT_MIN
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
                {events.map(a => {
                  const startMin = Math.max(minutesOfDay(a.startTime), GRID_START_MIN)
                  const endMin = Math.min(
                    Math.max(minutesOfDay(a.endTime), startMin + 15),
                    GRID_END_MIN,
                  )
                  if (startMin >= GRID_END_MIN) return null
                  const top = ((startMin - GRID_START_MIN) / SLOT_MIN) * SLOT_PX
                  const height = Math.max(((endMin - startMin) / SLOT_MIN) * SLOT_PX, 20)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onEventClick(a)}
                      className="absolute inset-x-1 overflow-hidden rounded border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-left hover:bg-primary/25"
                      style={{ top, height }}
                      title={`${fmtTime(a.startTime)}–${fmtTime(a.endTime)} ${a.typeLabel} — ${a.attendeeName}`}
                    >
                      <span className="block truncate text-[11px] font-medium leading-4 text-foreground">
                        {fmtTime(a.startTime)} {a.attendeeName}
                      </span>
                      <span className="block truncate text-[10px] leading-4 text-muted-foreground">
                        {a.typeLabel}
                      </span>
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
