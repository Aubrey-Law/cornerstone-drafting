'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BookingQuestion } from '@/lib/appointments/bookingQuestions'
import type { WeeklyHours } from '@/lib/appointments/types'
import type { ExternalCalendarRef } from '@/app/admin/calendar/types'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'
import { BlockingCalendarsEditor } from './BlockingCalendarsEditor'
import { BookingQuestionsEditor } from './BookingQuestionsEditor'

interface SettingsShape {
  timezone: string
  weeklyHours: WeeklyHours
  minNoticeHours: number
  horizonDays: number
  bufferMinutes: number
  reminderHoursBefore: number
  bookingPaused: boolean
  smsRemindersEnabled: boolean
  autoIntakeInvite: boolean
  dateOverrides: Record<string, Array<{ start: string; end: string }>>
  hiddenCalendarIds: string[]
  blockingCalendarIds: string[]
}

interface TypeShape {
  id: string
  key: string
  slug: string
  label: string
  description: string
  durationMinutes: number
  locationType: 'phone' | 'teams' | 'in_person'
  locationTypes: Array<'phone' | 'teams' | 'in_person'>
  active: boolean
  public: boolean
  sort: number
  customWeeklyHours: WeeklyHours | null
  bookingQuestions: BookingQuestion[]
}

interface AppointmentListItem {
  id: string
  startTime: string
  status: string
  attendeeName: string
  attendeeEmail: string
  typeLabel: string
  source: string
  calendarSynced: boolean
  linkedMatterId: string | null
  linkedLeadId: string | null
}

const LOCATION_OPTIONS = [
  ['phone', 'Phone call'],
  ['teams', 'Virtual meeting'],
  ['in_person', 'In person'],
] as const

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function SchedulingSettingsSection() {
  const token = useAccessToken()
  const [settings, setSettings] = useState<SettingsShape | null>(null)
  const [types, setTypes] = useState<TypeShape[]>([])
  const [appointments, setAppointments] = useState<AppointmentListItem[]>([])
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newOverrideDate, setNewOverrideDate] = useState('')
  const [accountCalendars, setAccountCalendars] = useState<ExternalCalendarRef[]>([])
  const [calendarsConnected, setCalendarsConnected] = useState(false)

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [settingsRes, apptRes, googleRes] = await Promise.all([
          fetch('/api/admin/scheduling/settings', { headers: authHeaders() }),
          fetch('/api/admin/scheduling/appointments', { headers: authHeaders() }),
          fetch('/api/admin/google/status', { headers: authHeaders() }),
        ])
        if (cancelled) return
        if (settingsRes.ok) {
          const json = await settingsRes.json()
          setSettings(json.settings)
          setTypes(json.types ?? [])
        }
        if (apptRes.ok) {
          const json = await apptRes.json()
          setAppointments(json.appointments ?? [])
        }
        if (googleRes.ok) {
          const json = await googleRes.json()
          // Calendar scope, not just a connection: a Google account linked for
          // mail alone cannot read busy times, and booking pages go dark the
          // same way as if nothing were connected at all.
          setCalendarConnected(Boolean(json.connected) && Boolean(json.hasCalendarScope))
        }
      } catch {
        if (!cancelled) toast.error('Failed to load scheduling settings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [authHeaders])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/scheduling/calendars', { headers: authHeaders() })
        if (cancelled || !res.ok) return
        const json = await res.json()
        if (cancelled) return
        setAccountCalendars(json.calendars ?? [])
        setCalendarsConnected(Boolean(json.connected))
      } catch {
        // The rest of scheduling settings stays editable without this.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authHeaders])

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      // Which calendars are *visible* belongs to the calendar page's popover,
      // not here. Sending it back would post whatever was loaded when this page
      // mounted, so hiding a calendar on the calendar page and then saving
      // anything here would quietly undo it. An absent field is left alone by
      // updateSchedulingSettings, which is what makes omitting it the fix.
      const { hiddenCalendarIds: _ownedByTheCalendarPage, ...owned } = settings
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ settings: owned, types }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Failed to save')
        return
      }
      const json = await res.json()
      setSettings(json.settings)
      setTypes(json.types ?? [])
      toast.success('Scheduling settings saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function updateType(id: string, patch: Partial<TypeShape>) {
    setTypes(list => list.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  if (loading) {
    return <div className="h-48 animate-pulse rounded-lg bg-muted" />
  }

  if (!settings) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load scheduling settings. Make sure the appointment scheduling migration has run.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {calendarConnected === false && (
        <div className="rounded-md border border-amber-border bg-amber-bg p-4 text-sm text-amber">
          <strong>Google Calendar is not connected.</strong> Booking pages will show
          “scheduling temporarily unavailable” until you connect it in the{' '}
          <Link href="/admin/settings?tab=google" className="underline">
            Google &amp; Teams settings
          </Link>
          .
        </div>
      )}

      {/* Five long sections; a jump row saves scrolling past the ones you are not editing. */}
      <nav aria-label="Scheduling sections" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[
          ['scheduling-rules', 'Booking rules'],
          ['scheduling-overrides', 'Date overrides'],
          ['scheduling-hours', 'Weekly hours'],
          ['scheduling-types', 'Appointment types'],
          ['scheduling-upcoming', 'Upcoming appointments'],
          ['scheduling-links', 'Booking links'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="underline-offset-2 hover:text-foreground hover:underline">{label}</a>
        ))}
      </nav>

      {/* Everything in here is saved by the one button at its foot, which stays pinned to the
          bottom of the screen while any of these sections is in view. */}
      <div className="space-y-6">
      <section id="scheduling-rules" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Booking rules</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="sched-tz">Timezone</Label>
            <Input
              id="sched-tz"
              className="mt-1"
              value={settings.timezone}
              onChange={e => setSettings({ ...settings, timezone: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sched-notice">Minimum notice (hours)</Label>
            <Input
              id="sched-notice"
              className="mt-1"
              type="number"
              min={0}
              value={settings.minNoticeHours}
              onChange={e => setSettings({ ...settings, minNoticeHours: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="sched-horizon">Booking horizon (days)</Label>
            <Input
              id="sched-horizon"
              className="mt-1"
              type="number"
              min={1}
              max={365}
              value={settings.horizonDays}
              onChange={e => setSettings({ ...settings, horizonDays: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="sched-buffer">Buffer between meetings (min)</Label>
            <Input
              id="sched-buffer"
              className="mt-1"
              type="number"
              min={0}
              value={settings.bufferMinutes}
              onChange={e => setSettings({ ...settings, bufferMinutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="sched-reminder">Reminder email (hours before)</Label>
            <Input
              id="sched-reminder"
              className="mt-1"
              type="number"
              min={0}
              max={336}
              value={settings.reminderHoursBefore}
              onChange={e =>
                setSettings({ ...settings, reminderHoursBefore: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">0 turns reminders off.</p>
          </div>
        </div>
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={settings.bookingPaused}
              onChange={e => setSettings({ ...settings, bookingPaused: e.target.checked })}
            />
            Pause online booking
            <span className="text-xs text-muted-foreground">
              — clients see “booking is paused”; you can still book from the calendar
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={settings.autoIntakeInvite}
              onChange={e => setSettings({ ...settings, autoIntakeInvite: e.target.checked })}
            />
            Auto-send the intake invite when a lead books a discovery call
          </label>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <BlockingCalendarsEditor
            calendars={accountCalendars}
            connected={calendarsConnected}
            blockingIds={settings.blockingCalendarIds ?? []}
            disabled={saving}
            onChange={next => setSettings({ ...settings, blockingCalendarIds: next })}
          />
        </div>
      </section>

      <section id="scheduling-overrides" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Date overrides</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Close specific dates (vacation, holidays) or set special hours that replace the
          weekly hours for that date only.
        </p>
        <div className="mt-3 space-y-2">
          {Object.entries(settings.dateOverrides)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, windows]) => (
              <div key={date} className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-sm text-foreground">{date}</span>
                {windows.length === 0 ? (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Closed all day
                  </span>
                ) : (
                  windows.map((w, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <Input
                        type="time"
                        className="h-8 w-28"
                        value={w.start}
                        onChange={e => {
                          const next = windows.map((win, j) =>
                            j === i ? { ...win, start: e.target.value } : win,
                          )
                          setSettings({
                            ...settings,
                            dateOverrides: { ...settings.dateOverrides, [date]: next },
                          })
                        }}
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input
                        type="time"
                        className="h-8 w-28"
                        value={w.end}
                        onChange={e => {
                          const next = windows.map((win, j) =>
                            j === i ? { ...win, end: e.target.value } : win,
                          )
                          setSettings({
                            ...settings,
                            dateOverrides: { ...settings.dateOverrides, [date]: next },
                          })
                        }}
                      />
                    </span>
                  ))
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      dateOverrides: {
                        ...settings.dateOverrides,
                        [date]:
                          windows.length === 0 ? [{ start: '09:00', end: '17:00' }] : [],
                      },
                    })
                  }
                >
                  {windows.length === 0 ? 'Set hours instead' : 'Close all day'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = { ...settings.dateOverrides }
                    delete next[date]
                    setSettings({ ...settings, dateOverrides: next })
                  }}
                >
                  ✕
                </Button>
              </div>
            ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              type="date"
              className="h-8 w-40"
              value={newOverrideDate}
              onChange={e => setNewOverrideDate(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!newOverrideDate || newOverrideDate in settings.dateOverrides}
              onClick={() => {
                setSettings({
                  ...settings,
                  dateOverrides: { ...settings.dateOverrides, [newOverrideDate]: [] },
                })
                setNewOverrideDate('')
              }}
            >
              + Add date
            </Button>
          </div>
        </div>
      </section>

      <section id="scheduling-hours" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Weekly hours</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Bookable windows in {settings.timezone}. Google Calendar busy times are automatically excluded.
        </p>
        <div className="mt-4">
          <WeeklyHoursEditor
            value={settings.weeklyHours}
            onChange={weeklyHours => setSettings(s => (s ? { ...s, weeklyHours } : s))}
          />
        </div>
      </section>

      <section id="scheduling-types" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Appointment types</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Public types are bookable by anyone at /book/&lt;slug&gt;; others require a signed-in
          portal client.
        </p>
        <div className="mt-4 space-y-4">
          {types.map(t => (
            <div key={t.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{t.label}</p>
                  <p className="text-xs text-muted-foreground">/book/{t.slug}</p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={t.active}
                      onChange={e => updateType(t.id, { active: e.target.checked })}
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={t.public}
                      onChange={e => updateType(t.id, { public: e.target.checked })}
                    />
                    Public
                  </label>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Duration (minutes)</Label>
                  <Input
                    className="mt-1 h-8"
                    type="number"
                    min={5}
                    max={480}
                    value={t.durationMinutes}
                    onChange={e => updateType(t.id, { durationMinutes: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Meeting formats offered</Label>
                  <div className="mt-2 space-y-1">
                    {LOCATION_OPTIONS.map(([value, label]) => {
                      const checked = t.locationTypes.includes(value)
                      return (
                        <label
                          key={value}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            // The last remaining format can't be removed.
                            disabled={checked && t.locationTypes.length === 1}
                            onChange={e =>
                              updateType(t.id, {
                                locationTypes: e.target.checked
                                  ? [...t.locationTypes, value]
                                  : t.locationTypes.filter(v => v !== value),
                              })
                            }
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Label</Label>
                  <Input
                    className="mt-1 h-8"
                    value={t.label}
                    onChange={e => updateType(t.id, { label: e.target.value })}
                  />
                </div>
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={t.customWeeklyHours !== null}
                    onChange={e =>
                      updateType(t.id, {
                        // Seed from the general hours so toggling on never
                        // starts from "unavailable every day".
                        customWeeklyHours: e.target.checked
                          ? structuredClone(settings.weeklyHours)
                          : null,
                      })
                    }
                  />
                  Limit this type to its own hours
                </label>
                {t.customWeeklyHours !== null && (
                  <div className="mt-3 rounded-md bg-muted p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      {t.label} can only be booked in these windows ({settings.timezone}).
                      General weekly hours are ignored for this type; Google Calendar busy times and
                      buffers still apply.
                    </p>
                    <WeeklyHoursEditor
                      compact
                      value={t.customWeeklyHours}
                      onChange={customWeeklyHours => updateType(t.id, { customWeeklyHours })}
                    />
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium text-foreground">Booking questions</p>
                <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
                  Asked on the details step when a client books {t.label}. Answers appear on the
                  appointment, in the booking alert email, and in the calendar event.
                </p>
                <BookingQuestionsEditor
                  value={t.bookingQuestions ?? []}
                  onChange={bookingQuestions => updateType(t.id, { bookingQuestions })}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save scheduling settings'}
        </Button>
        <span className="text-xs text-muted-foreground">Saves booking rules, date overrides, weekly hours and appointment types.</span>
      </div>
      </div>

      <section id="scheduling-upcoming" className="scroll-mt-4 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Upcoming appointments</h2>
        {appointments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No upcoming appointments.</p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {appointments.map(a => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm text-foreground">
                    {a.typeLabel} — {a.attendeeName}
                    {a.status !== 'scheduled' && (
                      <span className="ml-2 text-xs uppercase text-muted-foreground">
                        {a.status}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtWhen(a.startTime)} · {a.attendeeEmail}
                    {!a.calendarSynced && a.status === 'scheduled' && (
                      <span className="ml-2 text-amber">⚠ not on Google Calendar</span>
                    )}
                  </p>
                </div>
                {a.linkedMatterId ? (
                  <Link
                    href={`/admin/matters/${a.linkedMatterId}`}
                    className="text-xs text-primary underline"
                  >
                    View matter
                  </Link>
                ) : a.linkedLeadId ? (
                  <Link
                    href={`/admin/crm/opportunities/${a.linkedLeadId}`}
                    className="text-xs text-primary underline"
                  >
                    View lead
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
