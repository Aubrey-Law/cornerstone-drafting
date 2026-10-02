'use client'

import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

const DAY_MS = 86_400_000
/** Mirrors MAX_RANGE_DAYS in /api/scheduling/availability. */
const MAX_RANGE_DAYS = 31
/** Hard cap on paging ahead, before the firm's booking horizon is known. */
const MAX_MONTHS_AHEAD = 6
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface AvailabilityResponse {
  slots?: string[]
  paused?: boolean
  timezone?: string
  durationMinutes?: number
  /** How far ahead the firm takes bookings (Settings → Scheduling). */
  horizonDays?: number
  error?: string
}

export interface SlotPickerProps {
  /** Appointment type slug for the availability API. */
  typeSlug: string
  /** Optional manage token (reschedule flow for portal-only types). */
  manageToken?: string
  selected: string | null
  onSelect: (slotIso: string | null) => void
  /** Bumped by the parent to force a slot refresh (e.g. after slot_taken). */
  refreshKey?: number
  /**
   * When set, the picker renders its own Continue control: at the foot of the
   * times column on wide layouts, and as a sticky bottom bar on narrow ones.
   */
  onContinue?: () => void
  /** Message shown above the times list (e.g. a slot_taken error). */
  notice?: string | null
  /** Rendered at the top of the calendar column (e.g. a back link). */
  header?: ReactNode
}

/** Local calendar-day key, `YYYY-MM-DD`. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function fmtLongDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtShortDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

type BrowserTimeZone = { id: string; name: string }
let cachedTimeZone: BrowserTimeZone | null = null

/** Browser zone ID plus a friendly name ("Eastern Time"), falling back to the ID. */
function readBrowserTimeZone(): BrowserTimeZone {
  if (cachedTimeZone) return cachedTimeZone
  const id = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time'
  let name = id
  try {
    name =
      new Intl.DateTimeFormat('en-US', { timeZoneName: 'longGeneric' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value ?? id
  } catch {
    // Older engines without `longGeneric`: the ID is still accurate.
  }
  cachedTimeZone = { id, name }
  return cachedTimeZone
}

const noopSubscribe = () => () => {}

/**
 * The client's time zone, or null during SSR and hydration — the server's zone
 * is not the client's, so rendering it would mismatch.
 */
export function useBrowserTimeZone(): BrowserTimeZone | null {
  return useSyncExternalStore(noopSubscribe, readBrowserTimeZone, () => null)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export default function SlotPicker({
  typeSlug,
  manageToken,
  selected,
  onSelect,
  refreshKey = 0,
  onContinue,
  notice,
  header,
}: SlotPickerProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [horizonDays, setHorizonDays] = useState<number | null>(null)
  // Until the client navigates or picks, skip forward past empty months (e.g.
  // late in a month with nothing left) so the first screen shows openings.
  const [autoAdvance, setAutoAdvance] = useState(true)

  const tz = useBrowserTimeZone()
  const todayKey = dayKey(new Date())
  const currentMonth = startOfMonth(new Date())
  const canGoBack = month.getTime() > currentMonth.getTime()
  // Next is offered only while the next month starts inside the booking
  // horizon; past it the server returns nothing, so paging there is a dead end.
  const lastBookable = horizonDays !== null ? Date.now() + horizonDays * DAY_MS : null
  const canGoNext =
    month.getTime() < addMonths(currentMonth, MAX_MONTHS_AHEAD).getTime() &&
    (lastBookable === null || addMonths(month, 1).getTime() <= lastBookable)

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const from = Math.max(month.getTime(), Date.now())
        // Capped: a month that crosses a DST change can run past 31 × 24h.
        const to = Math.min(addMonths(month, 1).getTime(), from + MAX_RANGE_DAYS * DAY_MS)
        const params = new URLSearchParams({
          type: typeSlug,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
        })
        if (manageToken) params.set('manageToken', manageToken)
        const res = await fetch(`/api/scheduling/availability?${params.toString()}`)
        const json = (await res.json().catch(() => ({}))) as AvailabilityResponse
        if (ignore) return
        if (typeof json.horizonDays === 'number' && Number.isFinite(json.horizonDays)) {
          setHorizonDays(json.horizonDays)
        }
        if (!res.ok) {
          setSlots([])
          setError(json.error ?? 'Could not load availability')
          return
        }
        if (json.paused) {
          setSlots([])
          setError('Online booking is temporarily paused. Please call or email us to schedule.')
          return
        }
        setSlots(json.slots ?? [])
      } catch {
        if (ignore) return
        setSlots([])
        setError('Could not load availability')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [typeSlug, manageToken, month, refreshKey])

  const slotsByDay = useMemo(() => {
    const byDay = new Map<string, string[]>()
    for (const slot of slots) {
      const key = dayKey(new Date(slot))
      const list = byDay.get(key) ?? []
      list.push(slot)
      byDay.set(key, list)
    }
    return byDay
  }, [slots])

  // Keep the chosen day while it still has openings (returning from the
  // details step, or after a slot_taken refresh); otherwise default to the
  // first day with availability so the times column isn't empty.
  useEffect(() => {
    if (loading) return
    if (selectedDay && slotsByDay.has(selectedDay)) return
    const first = [...slotsByDay.keys()].sort()[0] ?? null
    setSelectedDay(first)
    if (selected && (!first || !slotsByDay.get(first)?.includes(selected))) onSelect(null)
  }, [loading, slotsByDay, selectedDay, selected, onSelect])

  useEffect(() => {
    if (!autoAdvance || loading || error) return
    if (slots.length > 0 || !canGoNext) {
      setAutoAdvance(false)
      return
    }
    setMonth(m => addMonths(m, 1))
    setSelectedDay(null)
  }, [autoAdvance, loading, error, slots.length, canGoNext])

  function pickDay(key: string) {
    setAutoAdvance(false)
    if (key === selectedDay) return
    setSelectedDay(key)
    onSelect(null)
  }

  function goMonth(delta: number) {
    setAutoAdvance(false)
    setMonth(m => addMonths(m, delta))
    setSelectedDay(null)
  }

  // Still loading, or about to skip an empty month: show the skeleton, not
  // a flash of "No open times".
  const pending = loading || (autoAdvance && !error && slots.length === 0 && canGoNext)

  const weeks = useMemo(() => {
    const cells: (Date | null)[] = Array.from({ length: month.getDay() }, () => null)
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
    while (cells.length % 7) cells.push(null)
    const rows: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [month])

  const daySlots = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : []
  const selectedDate = selectedDay ? parseDayKey(selectedDay) : null

  const navButton =
    'grid size-11 place-items-center rounded-full border border-border bg-card text-xl leading-none text-primary transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 @2xl/picker:size-9 @2xl/picker:text-lg'

  const calendar = (
    <div className="flex flex-col gap-4 @2xl/picker:gap-5 @2xl/picker:px-9 @2xl/picker:pt-9 @2xl/picker:pb-8">
      {header}
      <h2 className="hidden text-xl font-semibold text-foreground @2xl/picker:block">
        Choose a day
      </h2>
      <div className="rounded-[14px] border border-border bg-card px-3 pt-4 pb-3 @2xl/picker:rounded-none @2xl/picker:border-0 @2xl/picker:bg-transparent @2xl/picker:p-0">
        <div className="mb-3 flex items-center justify-between gap-2 px-1 @2xl/picker:mb-4 @2xl/picker:px-0">
          <p className="text-lg font-semibold text-foreground">{fmtMonth(month)}</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className={navButton}
              aria-label="Previous month"
              disabled={!canGoBack || pending}
              onClick={() => goMonth(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className={navButton}
              aria-label="Next month"
              disabled={!canGoNext || pending}
              onClick={() => goMonth(1)}
            >
              ›
            </button>
          </div>
        </div>
        <div role="grid" aria-label={fmtMonth(month)}>
          <div role="row" className="grid grid-cols-7 pb-2">
            {WEEKDAYS.map(w => (
              <div
                key={w}
                role="columnheader"
                aria-label={w}
                className="text-center text-xs font-semibold tracking-[.07em] text-muted-foreground uppercase"
              >
                <span className="@2xl/picker:hidden">{w[0]}</span>
                <span className="hidden @2xl/picker:inline">{w}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-y-1.5">
            {weeks.map((week, wi) => (
              <div role="row" key={wi} className="grid grid-cols-7">
                {week.map((date, di) => {
                  if (!date) return <div role="gridcell" key={di} />
                  const key = dayKey(date)
                  const count = slotsByDay.get(key)?.length ?? 0
                  const available = count > 0 && !pending
                  const isSelected = key === selectedDay && !pending
                  const isToday = key === todayKey
                  return (
                    <div role="gridcell" key={di} className="flex justify-center">
                      <button
                        type="button"
                        disabled={!available}
                        aria-current={isSelected ? 'date' : undefined}
                        aria-label={`${fmtLongDay(date)}, ${count > 0 ? plural(count, 'open time') : 'no open times'}`}
                        onClick={() => pickDay(key)}
                        className={`relative grid size-11 place-items-center rounded-full text-base transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 @2xl/picker:size-12 ${
                          pending
                            ? 'animate-pulse bg-muted text-transparent'
                            : isSelected
                              ? 'bg-brand-teal font-semibold text-white'
                              : available
                                ? 'cursor-pointer bg-selected font-semibold text-selected-foreground hover:ring-1 hover:ring-brand-teal'
                                : 'text-[var(--booking-disabled)]'
                        }`}
                      >
                        {date.getDate()}
                        {isToday && !pending && (
                          <span
                            aria-hidden
                            className={`absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full ${
                              isSelected ? 'bg-white' : 'bg-primary'
                            }`}
                          />
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-compact text-muted-foreground @2xl/picker:mt-auto @2xl/picker:justify-start">
        <span className="hidden items-center gap-2 @2xl/picker:inline-flex">
          <span aria-hidden className="size-3.5 rounded-full bg-selected" />
          Open times
        </span>
        {tz && (
          <span>
            Times shown in {tz.name}
            {tz.name !== tz.id ? ` (${tz.id})` : ''}
          </span>
        )}
      </div>
    </div>
  )

  let timesBody: ReactNode
  if (pending) {
    timesBody = (
      <div className="grid grid-cols-2 gap-2 @2xl/picker:grid-cols-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted @2xl/picker:h-[46px]" />
        ))}
      </div>
    )
  } else if (slotsByDay.size === 0) {
    timesBody = (
      <div className="py-6 text-center text-base text-muted-foreground @2xl/picker:my-auto">
        <p>No open times this month.</p>
        {!canGoNext && horizonDays !== null && (
          <p className="mt-1 text-sm">
            We take online bookings up to {horizonDays} days ahead. Please call us for a later date.
          </p>
        )}
        {canGoNext && (
          <button
            type="button"
            className="mt-2 font-medium text-brand-teal underline-offset-4 hover:underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => goMonth(1)}
          >
            Next month →
          </button>
        )}
      </div>
    )
  } else if (!selectedDate) {
    timesBody = (
      <p className="py-6 text-center text-base text-muted-foreground @2xl/picker:my-auto">
        Pick a highlighted day to see open times.
      </p>
    )
  } else {
    timesBody = (
      <>
        <div className="flex items-baseline justify-between gap-2 @2xl/picker:block">
          <p className="text-lg font-semibold text-foreground">{fmtLongDay(selectedDate)}</p>
          <p className="text-sm text-muted-foreground">
            <span className="@2xl/picker:hidden">{plural(daySlots.length, 'time')}</span>
            <span className="hidden @2xl/picker:inline">{plural(daySlots.length, 'open time')}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 @2xl/picker:max-h-[440px] @2xl/picker:grid-cols-1 @2xl/picker:overflow-y-auto @2xl/picker:p-0.5">
          {daySlots.map(slot => {
            const isSelected = selected === slot
            return (
              <button
                key={slot}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(isSelected ? null : slot)}
                className={`h-12 w-full shrink-0 rounded-lg border text-base font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 @2xl/picker:h-[46px] ${
                  isSelected
                    ? 'border-brand-teal bg-brand-teal text-white'
                    : 'border-border bg-card text-primary hover:border-brand-teal'
                }`}
              >
                {fmtTime(slot)}
              </button>
            )
          })}
        </div>
      </>
    )
  }

  const selectedSummary = selected
    ? `${fmtShortDay(new Date(selected))} · ${fmtTime(selected)}`
    : null

  const primaryButton =
    'h-12 rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-[var(--booking-primary-hover)] disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

  return (
    <div className="client-booking @container/picker flex h-full flex-col">
      {error ? (
        <div className="p-5 @2xl/picker:p-9">
          <div className="rounded-[10px] border border-border bg-[var(--booking-panel)] p-5 text-base text-muted-foreground">
            {error}
          </div>
        </div>
      ) : (
        <div className="grid flex-1 gap-4 p-5 @2xl/picker:grid-cols-[minmax(0,1fr)_280px] @2xl/picker:gap-0 @2xl/picker:p-0">
          {calendar}
          <div className="flex flex-col gap-3 @2xl/picker:gap-4 @2xl/picker:border-l @2xl/picker:border-border @2xl/picker:bg-[var(--booking-panel)] @2xl/picker:px-6 @2xl/picker:pt-9 @2xl/picker:pb-6">
            {notice && (
              <p role="alert" className="text-sm text-destructive">
                {notice}
              </p>
            )}
            {timesBody}
            {onContinue && (
              <button
                type="button"
                className={`${primaryButton} mt-auto hidden w-full @2xl/picker:block`}
                disabled={!selected}
                onClick={onContinue}
              >
                Continue
              </button>
            )}
          </div>
        </div>
      )}

      {onContinue && !error && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-card px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-12px_rgba(31,45,90,.2)] @2xl/picker:hidden">
          <p
            className={`text-base ${selectedSummary ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
          >
            {selectedSummary ?? 'Pick a time'}
          </p>
          <button
            type="button"
            className={`${primaryButton} px-[22px]`}
            disabled={!selected}
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
