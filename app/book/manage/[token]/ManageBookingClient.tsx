'use client'

import { useCallback, useEffect, useState } from 'react'
import SlotPicker from '@/components/scheduling/SlotPicker'
import { Button } from '@/components/ui/button'

interface ManagedAppointment {
  status: 'scheduled' | 'cancelled' | 'rescheduled'
  startTime: string
  endTime: string
  attendeeName: string
  type: {
    key: string
    slug: string
    label: string
    durationMinutes: number
    locationType: string
  } | null
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function ManageBookingClient({ token }: { token: string }) {
  const [appointment, setAppointment] = useState<ManagedAppointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<'view' | 'reschedule'>('view')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [done, setDone] = useState<'cancelled' | 'rescheduled' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/scheduling/manage/${encodeURIComponent(token)}`)
      if (!res.ok) {
        setNotFound(true)
        return
      }
      const json = (await res.json()) as { appointment: ManagedAppointment }
      setAppointment(json.appointment)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function act(body: { action: 'cancel' } | { action: 'reschedule'; startTime: string }) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/manage/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        code?: string
        startIso?: string
      }
      if (!res.ok || !json.ok) {
        if (json.code === 'slot_taken') {
          setSelected(null)
          setRefreshKey(k => k + 1)
        }
        setError(json.error ?? 'Request failed. Please try again.')
        return
      }
      setDone(body.action === 'cancel' ? 'cancelled' : 'rescheduled')
      await load()
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" />
  }

  if (notFound || !appointment) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Booking not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is invalid or has expired. Please contact the firm to make changes.
        </p>
      </div>
    )
  }

  if (done === 'cancelled' || appointment.status === 'cancelled') {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Appointment cancelled</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your {appointment.type?.label ?? 'appointment'} has been cancelled. You&apos;re welcome
          to book a new time whenever you&apos;re ready.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          {appointment.type?.label ?? 'Appointment'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{fmtWhen(appointment.startTime)}</p>
        {done === 'rescheduled' && (
          <p className="mt-2 text-sm text-foreground">
            Your appointment has been moved. An updated invitation is on its way.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setMode(m => (m === 'reschedule' ? 'view' : 'reschedule'))}
          >
            {mode === 'reschedule' ? 'Keep current time' : 'Reschedule'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Cancel this appointment?')) void act({ action: 'cancel' })
            }}
          >
            Cancel appointment
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {mode === 'reschedule' && appointment.type && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Pick a new time</h3>
          <div className="mt-4">
            <SlotPicker
              typeSlug={appointment.type.slug}
              manageToken={token}
              selected={selected}
              onSelect={setSelected}
              refreshKey={refreshKey}
            />
          </div>
          {selected && (
            <Button
              type="button"
              className="mt-4"
              disabled={busy}
              onClick={() => void act({ action: 'reschedule', startTime: selected })}
            >
              {busy ? 'Moving…' : `Move to ${fmtWhen(selected)}`}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
