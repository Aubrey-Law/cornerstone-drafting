'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WeeklyHours, Weekday } from '@/lib/appointments/types'

const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

interface SettingsShape {
  timezone: string
  weeklyHours: WeeklyHours
  minNoticeHours: number
  horizonDays: number
  bufferMinutes: number
}

interface TypeShape {
  id: string
  key: string
  slug: string
  label: string
  description: string
  durationMinutes: number
  locationType: 'phone' | 'teams' | 'in_person'
  active: boolean
  public: boolean
  sort: number
}

interface AppointmentListItem {
  id: string
  startTime: string
  status: string
  attendeeName: string
  attendeeEmail: string
  typeLabel: string
  source: string
  outlookSynced: boolean
  linkedMatterId: string | null
  linkedLeadId: string | null
}

const LOCATION_OPTIONS = [
  ['phone', 'Phone'],
  ['teams', 'Teams video'],
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
  const [outlookConnected, setOutlookConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [settingsRes, apptRes, outlookRes] = await Promise.all([
          fetch('/api/admin/scheduling/settings', { headers: authHeaders() }),
          fetch('/api/admin/scheduling/appointments', { headers: authHeaders() }),
          fetch('/api/admin/microsoft/status', { headers: authHeaders() }),
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
        if (outlookRes.ok) {
          const json = await outlookRes.json()
          setOutlookConnected(Boolean(json.connected))
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

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ settings, types }),
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

  function updateWindow(day: Weekday, index: number, field: 'start' | 'end', value: string) {
    setSettings(s => {
      if (!s) return s
      const windows = [...(s.weeklyHours[day] ?? [])]
      windows[index] = { ...windows[index], [field]: value }
      return { ...s, weeklyHours: { ...s.weeklyHours, [day]: windows } }
    })
  }

  function addWindow(day: Weekday) {
    setSettings(s => {
      if (!s) return s
      const windows = [...(s.weeklyHours[day] ?? []), { start: '09:00', end: '17:00' }]
      return { ...s, weeklyHours: { ...s.weeklyHours, [day]: windows } }
    })
  }

  function removeWindow(day: Weekday, index: number) {
    setSettings(s => {
      if (!s) return s
      const windows = (s.weeklyHours[day] ?? []).filter((_, i) => i !== index)
      return { ...s, weeklyHours: { ...s.weeklyHours, [day]: windows } }
    })
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
      {outlookConnected === false && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Outlook is not connected.</strong> Booking pages will show “scheduling
          temporarily unavailable” until you connect Outlook in the{' '}
          <Link href="/admin/settings?tab=outlook" className="underline">
            Outlook tab
          </Link>
          .
        </div>
      )}

      <section className="rounded-lg border border-border p-4">
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
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Weekly hours</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Bookable windows in {settings.timezone}. Outlook busy times are automatically excluded.
        </p>
        <div className="mt-4 space-y-3">
          {WEEKDAY_ORDER.map(day => (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm text-foreground">{WEEKDAY_LABELS[day]}</span>
              {(settings.weeklyHours[day] ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">Unavailable</span>
              )}
              {(settings.weeklyHours[day] ?? []).map((w, i) => (
                <span key={i} className="flex items-center gap-1">
                  <Input
                    type="time"
                    className="h-8 w-28"
                    value={w.start}
                    onChange={e => updateWindow(day, i, 'start', e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    type="time"
                    className="h-8 w-28"
                    value={w.end}
                    onChange={e => updateWindow(day, i, 'end', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWindow(day, i)}
                  >
                    ✕
                  </Button>
                </span>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addWindow(day)}>
                + Add
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
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
                  <Label className="text-xs">Format</Label>
                  <select
                    className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                    value={t.locationType}
                    onChange={e =>
                      updateType(t.id, { locationType: e.target.value as TypeShape['locationType'] })
                    }
                  >
                    {LOCATION_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
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
            </div>
          ))}
        </div>
      </section>

      <div>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save scheduling settings'}
        </Button>
      </div>

      <section className="rounded-lg border border-border p-4">
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
                    {!a.outlookSynced && a.status === 'scheduled' && (
                      <span className="ml-2 text-amber-700">⚠ not on Outlook calendar</span>
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
                    href={`/admin/leads/${a.linkedLeadId}`}
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
