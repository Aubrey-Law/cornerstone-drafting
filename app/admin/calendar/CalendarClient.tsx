'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CalendarAppointment {
  id: string
  startTime: string
  endTime: string
  status: 'scheduled' | 'cancelled' | 'rescheduled'
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

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

/** Local-date key (YYYY-MM-DD) — calendar renders in the browser timezone. */
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

/** The 42-cell (6-week) Sunday-start grid containing the given month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

export function CalendarClient() {
  const token = useAccessToken()
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string>(dayKey(today))

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const from = grid[0]
        const to = new Date(grid[41].getTime() + DAY_MS)
        const res = await fetch(
          `/api/admin/scheduling/appointments?from=${from.toISOString()}&to=${to.toISOString()}`,
          { headers: authHeaders() },
        )
        if (cancelled) return
        if (!res.ok) {
          toast.error('Failed to load appointments')
          return
        }
        const json = await res.json()
        setAppointments(json.appointments ?? [])
      } catch {
        if (!cancelled) toast.error('Failed to load appointments')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [grid, authHeaders])

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

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  function shiftMonth(delta: number) {
    setCursor(c => {
      const d = new Date(c.year, c.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCursor({ year: today.getFullYear(), month: today.getMonth() })
              setSelectedDay(todayKey)
            }}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 min-w-36 text-sm font-medium text-foreground">{monthLabel}</span>
          <Button asChild variant="ghost" size="sm" title="Scheduling settings">
            <Link href="/admin/settings?tab=scheduling">
              <Settings className="mr-1 h-4 w-4" />
              Scheduling
            </Link>
          </Button>
        </div>
      </div>

      <div className={cn('rounded-lg border border-border', loading && 'opacity-60')}>
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
            const inMonth = date.getMonth() === cursor.month
            const dayAppointments = byDay.get(key) ?? []
            const shown = dayAppointments.slice(0, 3)
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDay(key)}
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

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">{fmtDayHeading(selectedDate)}</h2>
        {selectedAppointments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No appointments.</p>
        ) : (
          <div className="mt-2 divide-y divide-border">
            {selectedAppointments.map(a => (
              <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div>
                  <p className={cn('text-sm text-foreground', a.status === 'cancelled' && 'line-through')}>
                    {fmtTime(a.startTime)}–{fmtTime(a.endTime)} · {a.typeLabel} — {a.attendeeName}
                    {a.status !== 'scheduled' && (
                      <span className="ml-2 text-xs uppercase text-muted-foreground">{a.status}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.attendeeEmail}
                    {a.attendeePhone ? ` · ${a.attendeePhone}` : ''}
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
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
