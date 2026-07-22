'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

const DAY_MS = 86_400_000

interface AvailabilityResponse {
  slots?: string[]
  timezone?: string
  durationMinutes?: number
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
}

function startOfDay(ts: number): Date {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d
}

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function SlotPicker({
  typeSlug,
  manageToken,
  selected,
  onSelect,
  refreshKey = 0,
}: SlotPickerProps) {
  const [weekStart, setWeekStart] = useState(() => startOfDay(Date.now()))
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const browserTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time',
    [],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const from = weekStart.toISOString()
      const to = new Date(weekStart.getTime() + 7 * DAY_MS).toISOString()
      const params = new URLSearchParams({ type: typeSlug, from, to })
      if (manageToken) params.set('manageToken', manageToken)
      const res = await fetch(`/api/scheduling/availability?${params.toString()}`)
      const json = (await res.json().catch(() => ({}))) as AvailabilityResponse
      if (!res.ok) {
        setSlots([])
        setError(json.error ?? 'Could not load availability')
        return
      }
      setSlots(json.slots ?? [])
    } catch {
      setSlots([])
      setError('Could not load availability')
    } finally {
      setLoading(false)
    }
  }, [typeSlug, manageToken, weekStart])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const days = useMemo(() => {
    const byDay = new Map<string, string[]>()
    for (const slot of slots) {
      const key = startOfDay(Date.parse(slot)).toISOString()
      const list = byDay.get(key) ?? []
      list.push(slot)
      byDay.set(key, list)
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart.getTime() + i * DAY_MS)
      return { day, slots: byDay.get(startOfDay(day.getTime()).toISOString()) ?? [] }
    })
  }, [slots, weekStart])

  const canGoBack = weekStart.getTime() > startOfDay(Date.now()).getTime()

  return (
    <div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoBack || loading}
          onClick={() => setWeekStart(w => startOfDay(Math.max(w.getTime() - 7 * DAY_MS, Date.now())))}
        >
          ← Previous week
        </Button>
        <p className="text-xs text-muted-foreground">Times shown in {browserTz}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => setWeekStart(w => startOfDay(w.getTime() + 7 * DAY_MS))}
        >
          Next week →
        </Button>
      </div>

      {error ? (
        <div className="mt-6 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {error}
        </div>
      ) : loading ? (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <div className="mt-6 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No open times this week. Try the next week.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {days
            .filter(d => d.slots.length > 0)
            .map(({ day, slots: daySlots }) => (
              <div key={day.toISOString()}>
                <p className="text-sm font-medium text-foreground">{fmtDayLabel(day)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {daySlots.map(slot => (
                    <Button
                      key={slot}
                      type="button"
                      size="sm"
                      variant={selected === slot ? 'default' : 'outline'}
                      onClick={() => onSelect(selected === slot ? null : slot)}
                    >
                      {fmtTime(slot)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
