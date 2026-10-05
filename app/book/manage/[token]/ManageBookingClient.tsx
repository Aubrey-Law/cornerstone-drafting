'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SlotPicker, { fmtLongDay, fmtTime } from '@/components/scheduling/SlotPicker'
import {
  BookingCard,
  BrandHeader,
  EventMeta,
  FOCUS,
  fmtRange,
  isLocationType,
  PRIMARY_BUTTON,
  ResultPanel,
  TimeSummary,
} from '@/components/scheduling/bookingUi'

interface ManagedAppointment {
  status: 'scheduled' | 'cancelled' | 'rescheduled' | 'no_show'
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

type Mode = 'view' | 'pick' | 'confirm' | 'moved'

const BODY = 'flex flex-col gap-5 p-5 @3xl/booking:gap-[22px] @3xl/booking:px-10 @3xl/booking:py-9'
const SECONDARY_BUTTON = `rounded-lg border border-border bg-card font-semibold text-primary transition-colors hover:border-brand-teal disabled:pointer-events-none disabled:opacity-60 ${FOCUS}`
const LINK_BUTTON = `self-start rounded-md text-base font-medium text-brand-teal hover:underline ${FOCUS}`

function durationOf(appointment: ManagedAppointment): number {
  return (
    appointment.type?.durationMinutes ??
    Math.round((Date.parse(appointment.endTime) - Date.parse(appointment.startTime)) / 60_000)
  )
}

/** Day + time range card; on wide layouts the left panel shows this instead. */
function TimeCard({
  iso,
  durationMinutes,
  label,
  tone = 'selected',
  wideToo = false,
}: {
  iso: string
  durationMinutes: number
  label?: string
  tone?: 'selected' | 'muted'
  wideToo?: boolean
}) {
  return (
    <div
      className={`rounded-[10px] border px-4 py-3.5 ${
        tone === 'selected'
          ? 'border-brand-teal bg-selected text-selected-foreground'
          : 'border-border bg-[var(--booking-panel)] text-muted-foreground'
      } ${wideToo ? '' : '@5xl/booking:hidden'}`}
    >
      {label && <p className="text-xs font-semibold tracking-[.07em] uppercase">{label}</p>}
      <p className={`text-lg font-semibold ${label ? 'mt-1' : ''}`}>{fmtLongDay(new Date(iso))}</p>
      <p className="text-base">{fmtRange(iso, durationMinutes)}</p>
    </div>
  )
}

export default function ManageBookingClient({
  token,
  firmName = 'Aubrey Law',
  officeAddress,
}: {
  token: string
  firmName?: string
  officeAddress?: string
}) {
  const [appointment, setAppointment] = useState<ManagedAppointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<Mode>('view')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // The picker mounts on the first Reschedule click (no availability fetch
  // just for viewing) and then stays mounted so a round-trip keeps its month.
  const [pickerMounted, setPickerMounted] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
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

  function goTo(next: Mode) {
    if (next === 'pick') setPickerMounted(true)
    setMode(next)
    const root = rootRef.current
    if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView?.({ block: 'start' })
  }

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
      }
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Request failed. Please try again.')
        if (json.code === 'slot_taken') {
          setSelected(null)
          setRefreshKey(k => k + 1)
          goTo('pick')
        }
        return
      }
      await load()
      setConfirmingCancel(false)
      setSelected(null)
      goTo(body.action === 'cancel' ? 'view' : 'moved')
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <BookingCard
        aside={
          <>
            <BrandHeader firmName={firmName} />
            <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
            <div className="h-5 w-1/2 animate-pulse rounded-md bg-muted" />
          </>
        }
      >
        <div className={BODY}>
          <div className="h-7 w-1/2 animate-pulse rounded-md bg-muted" />
          <div className="h-20 animate-pulse rounded-[10px] bg-muted" />
          <div className="h-12 w-48 animate-pulse rounded-lg bg-muted" />
        </div>
      </BookingCard>
    )
  }

  if (notFound || !appointment) {
    return (
      <BookingCard
        aside={
          <>
            <BrandHeader firmName={firmName} />
            <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.015em] text-primary @5xl/booking:text-3xl">
              Manage your appointment
            </h1>
          </>
        }
      >
        <ResultPanel icon="?" tone="neutral" title="Booking not found">
          <p className="text-base text-muted-foreground">
            This link is invalid or has expired. Please contact the firm to make changes.
          </p>
        </ResultPanel>
      </BookingCard>
    )
  }

  const duration = durationOf(appointment)
  const locationType =
    appointment.type && isLocationType(appointment.type.locationType)
      ? appointment.type.locationType
      : null
  const label = appointment.type?.label ?? 'Appointment'
  const firstName = appointment.attendeeName.trim().split(/\s+/)[0] ?? ''

  const aside = (
    <>
      <BrandHeader firmName={firmName} />
      <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.015em] text-primary @5xl/booking:text-3xl">
        {label}
      </h1>
      <EventMeta durationMinutes={duration} locationType={locationType} officeAddress={officeAddress} />
      {appointment.status === 'scheduled' && (mode === 'pick' || mode === 'moved') && (
        <TimeSummary
          label={mode === 'moved' ? 'Your new time' : 'Your appointment'}
          iso={appointment.startTime}
          durationMinutes={duration}
          dayLabel={fmtLongDay(new Date(appointment.startTime))}
        />
      )}
    </>
  )

  if (appointment.status === 'cancelled') {
    return (
      <BookingCard rootRef={rootRef} aside={aside}>
        <ResultPanel icon="✕" tone="neutral" title="Appointment cancelled">
          <p className="text-lg leading-[1.6] text-foreground">
            {label} — {fmtLongDay(new Date(appointment.startTime))} at{' '}
            {fmtTime(appointment.startTime)}
          </p>
          <p className="text-base text-muted-foreground">
            You&apos;re welcome to book a new time whenever you&apos;re ready.
          </p>
          {appointment.type && (
            <a
              href={`/book/${encodeURIComponent(appointment.type.slug)}`}
              className={`${PRIMARY_BUTTON} mt-2 inline-flex h-12 items-center px-6 text-base`}
            >
              Book a new time
            </a>
          )}
        </ResultPanel>
      </BookingCard>
    )
  }

  if (appointment.status !== 'scheduled') {
    return (
      <BookingCard rootRef={rootRef} aside={aside}>
        <ResultPanel icon="!" tone="neutral" title="This booking can’t be changed online">
          <p className="text-base text-muted-foreground">
            Please contact the firm and we&apos;ll help you with your appointment.
          </p>
        </ResultPanel>
      </BookingCard>
    )
  }

  return (
    <BookingCard rootRef={rootRef} aside={aside}>
      {mode === 'moved' && (
        <ResultPanel icon="✓" title="Your appointment has moved">
          <p className="text-lg leading-[1.6] text-foreground">
            {label} — {fmtLongDay(new Date(appointment.startTime))} at{' '}
            {fmtTime(appointment.startTime)}
          </p>
          <p className="text-base text-muted-foreground">
            An updated calendar invitation is on its way.
          </p>
          <button
            type="button"
            className={`mt-2 rounded-md text-base font-medium text-brand-teal hover:underline ${FOCUS}`}
            onClick={() => goTo('view')}
          >
            Manage this appointment
          </button>
        </ResultPanel>
      )}

      {mode === 'view' && (
        <div className={BODY}>
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Manage your appointment</h2>
            <p className="mt-1 text-base text-muted-foreground">
              {firstName ? `Hi ${firstName}, need` : 'Need'} to change plans? Pick a new time or
              cancel below.
            </p>
          </div>
          <TimeCard iso={appointment.startTime} durationMinutes={duration} label="Your appointment" wideToo />

          {confirmingCancel ? (
            <div className="flex flex-col gap-4 rounded-[10px] border border-destructive/40 bg-destructive/5 px-4 py-4 @3xl/booking:px-5">
              <div>
                <p className="text-lg font-semibold text-foreground">Cancel this appointment?</p>
                <p className="mt-1 text-base text-muted-foreground">
                  We&apos;ll let the firm know and remove it from your calendar.
                </p>
              </div>
              <div className="flex flex-col gap-2.5 @3xl/booking:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  className={`h-12 rounded-lg bg-destructive px-6 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-60 ${FOCUS}`}
                  onClick={() => void act({ action: 'cancel' })}
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={`${SECONDARY_BUTTON} h-12 px-6 text-base`}
                  onClick={() => setConfirmingCancel(false)}
                >
                  Keep appointment
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 @3xl/booking:flex-row">
              <button
                type="button"
                disabled={busy}
                className={`${PRIMARY_BUTTON} h-[52px] px-7 text-lg @3xl/booking:h-[50px] @3xl/booking:text-base`}
                onClick={() => {
                  setError(null)
                  goTo('pick')
                }}
              >
                Reschedule
              </button>
              <button
                type="button"
                disabled={busy}
                className={`${SECONDARY_BUTTON} h-[52px] px-7 text-lg text-destructive @3xl/booking:h-[50px] @3xl/booking:text-base`}
                onClick={() => {
                  setError(null)
                  setConfirmingCancel(true)
                }}
              >
                Cancel appointment
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {appointment.type && pickerMounted && (
        <div hidden={mode !== 'pick'} className="h-full">
          <SlotPicker
            header={
              <button type="button" className={LINK_BUTTON} onClick={() => goTo('view')}>
                ← Keep current time
              </button>
            }
            typeSlug={appointment.type.slug}
            manageToken={token}
            selected={selected}
            onSelect={setSelected}
            refreshKey={refreshKey}
            notice={mode === 'pick' ? error : null}
            onContinue={() => {
              setError(null)
              goTo('confirm')
            }}
          />
        </div>
      )}

      {mode === 'confirm' && selected && (
        <div className={BODY}>
          <button type="button" className={LINK_BUTTON} onClick={() => goTo('pick')}>
            ← Change time
          </button>
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Confirm your new time</h2>
            <p className="mt-1 text-base text-muted-foreground">
              We&apos;ll move your appointment and send an updated calendar invitation.
            </p>
          </div>
          <div className="grid gap-3 @3xl/booking:grid-cols-2">
            <TimeCard
              iso={appointment.startTime}
              durationMinutes={duration}
              label="Current time"
              tone="muted"
              wideToo
            />
            <TimeCard iso={selected} durationMinutes={duration} label="New time" wideToo />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            className={`${PRIMARY_BUTTON} h-[52px] w-full px-7 text-lg @3xl/booking:h-[50px] @3xl/booking:w-auto @3xl/booking:self-start @3xl/booking:text-base`}
            onClick={() => void act({ action: 'reschedule', startTime: selected })}
          >
            {busy ? 'Moving…' : 'Move my appointment'}
          </button>
        </div>
      )}
    </BookingCard>
  )
}
