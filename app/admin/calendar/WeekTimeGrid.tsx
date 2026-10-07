'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { LoadIndicator } from './LoadIndicator'
import { columnInterval } from './calendarTime'
import { assignEventLanes } from './eventLayout'
import { minutesOfDay, timeGridBounds } from './timeGrid'
import { CATEGORY_STYLE, BLOCK_HATCH, categorize, isBlock } from './eventCategories'
import type { CalendarAppointment, ExternalCalendarEvent, PlanData } from './types'
const SLOT_MIN = 30
const SLOT_PX = 40
function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function fmtTime(iso: string, timezone = FIRM_TIMEZONE) { return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }) }
function calendarSource(event: ExternalCalendarEvent) { return event.calendarName ? `Google · ${event.calendarName}` : 'Google Calendar' }
function shortMatterLabel(number: string) { return number.split('-').slice(-2).join('-') }
function fmtGridHour(minutes: number) { const h = Math.floor(minutes / 60); return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}` }

export function TimeGrid(props: {
  days: Date[]
  byDay: Map<string, CalendarAppointment[]>
  calendarByDay: Map<string, ExternalCalendarEvent[]>
  todayKey: string
  now: Date
  timezone: string
  workload: PlanData['days']
  appointmentCounts: Map<string, number>
  selectedDay: string
  onSelectDay: (key: string) => void
  onSlotClick: (date: Date, time: string) => void
  onEventClick: (a: CalendarAppointment) => void
}) {
  const { days, byDay, calendarByDay, todayKey, now, timezone, workload, appointmentCounts, selectedDay, onSelectDay, onSlotClick, onEventClick } = props
  const [externalDetail, setExternalDetail] = useState<ExternalCalendarEvent | null>(null)
  // Widened past the business window when the days on screen hold earlier or
  // later events, so nothing on the calendar falls off the grid.
  const { startMin: gridStartMin, endMin: gridEndMin } = timeGridBounds(days, byDay, calendarByDay, timezone)
  const slotCount = (gridEndMin - gridStartMin) / SLOT_MIN
  const gridHeight = slotCount * SLOT_PX
  const nowMinutes = minutesOfDay(now.toISOString(), timezone)
  const showNow = days.some(day => dayKey(day) === todayKey) && nowMinutes >= gridStartMin && nowMinutes < gridEndMin

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Dialog open={externalDetail !== null} onOpenChange={open => !open && setExternalDetail(null)}>
        <DialogContent><DialogHeader><DialogTitle>{externalDetail?.subject}</DialogTitle></DialogHeader>
          {externalDetail && <p className="text-sm text-foreground">{fmtTime(externalDetail.startIso, timezone)}–{fmtTime(externalDetail.endIso, timezone)} · {calendarSource(externalDetail)}{externalDetail.showAs === 'free' ? ' · Free' : ''}</p>}
        </DialogContent>
      </Dialog>
      <div className="min-w-[640px]">
        <div
          className="grid border-b border-border bg-muted"
          style={{ gridTemplateColumns: `68px repeat(${days.length}, 1fr)` }}
        >
          <div />
          {days.map(d => {
            const key = dayKey(d)
            const dayCalendarEvents = calendarByDay.get(key) ?? []
            const allDay = dayCalendarEvents.filter(e => e.isAllDay && !isBlock(e))
            const allDayBlocked = dayCalendarEvents.some(e => e.isAllDay && isBlock(e))
            return (
              <div key={key} className="border-l border-border px-2 py-1.5 text-center">
                <button type="button" aria-pressed={selectedDay === key} onClick={() => onSelectDay(key)}
                  className={cn(
                    'text-xs font-medium rounded px-1 focus-visible:ring-2 focus-visible:ring-ring',
                    selectedDay === key ? 'bg-primary text-primary-foreground' : key === todayKey ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}
                </button>
                <LoadIndicator day={workload.find(day => day.date === key)} count={appointmentCounts.get(key) ?? 0} />
                {allDayBlocked && (
                  <span
                    className="mt-0.5 block truncate rounded px-1 text-micro leading-4 text-muted-foreground"
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
                      className="mt-0.5 block truncate rounded px-1 text-micro leading-4"
                      style={{
                        background: style.bg,
                        color: style.text,
                        borderLeft: `3px solid ${style.dot}`,
                      }}
                      title={`All day: ${e.subject} (${calendarSource(e)})`}
                    >
                      {e.subject}
                    </span>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `68px repeat(${days.length}, 1fr)` }}>
          <div className="relative" style={{ height: gridHeight }}>
            {showNow && <span className="pointer-events-none absolute right-0 z-20 whitespace-nowrap rounded bg-background px-1 text-micro font-semibold text-red" style={{ top: (nowMinutes - gridStartMin) / SLOT_MIN * SLOT_PX }}>{fmtTime(now.toISOString(), timezone)}</span>}
            {Array.from({ length: slotCount }, (_, i) => {
              const minutes = gridStartMin + i * SLOT_MIN
              return minutes % 60 === 0 ? (
                <span
                  key={i}
                  className="absolute right-1.5 -translate-y-1/2 text-micro text-muted-foreground"
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
            const timed = (calendarByDay.get(key) ?? []).filter(e => !e.isAllDay)
            const blocks = timed.filter(isBlock)
            const calendarTimed = timed.filter(e => !isBlock(e))
            const interval = (start: string, end: string) => { const value = columnInterval(key, start, end, timezone); return { start: Math.max(value.start, gridStartMin), end: Math.min(value.end, gridEndMin) } }
            const lanes = assignEventLanes([
              ...events.map(a => ({ id: `appointment:${a.id}`, ...interval(a.startTime, a.endTime) })),
              ...calendarTimed.map(e => ({ id: `calendar:${e.calendarId ?? ''}:${e.id}`, ...interval(e.startIso, e.endIso) })),
            ])
            const laneStyle = (id: string) => {
              const lane = lanes.get(id)
              return lane ? { left: `calc(${lane.lane * 100 / lane.lanes}% + 2px)`, width: `calc(${100 / lane.lanes}% - 4px)`, top: (lane.start - gridStartMin) / SLOT_MIN * SLOT_PX, height: Math.min((lane.end - lane.start) / SLOT_MIN * SLOT_PX, gridHeight - (lane.start - gridStartMin) / SLOT_MIN * SLOT_PX) } : {}
            }
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
                        'absolute inset-x-0 hover:bg-accent',
                        minutes % 60 === 0 ? 'border-t border-border' : 'border-t border-border/40',
                      )}
                      style={{ top: i * SLOT_PX, height: SLOT_PX }}
                    />
                  )
                })}
                {blocks.map(e => {
                  const startMin = interval(e.startIso, e.endIso).start
                  const endMin = Math.min(
                    Math.max(interval(e.startIso, e.endIso).end, startMin + 15),
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
                      title={`${fmtTime(e.startIso, timezone)}–${fmtTime(e.endIso, timezone)} ${e.subject} (blocked)`}
                    />
                  )
                })}
                {calendarTimed.map(e => {
                  const startMin = interval(e.startIso, e.endIso).start
                  const endMin = Math.min(
                    Math.max(interval(e.startIso, e.endIso).end, startMin + 15),
                    gridEndMin,
                  )
                  if (startMin >= gridEndMin) return null
                  const top = ((startMin - gridStartMin) / SLOT_MIN) * SLOT_PX
                  const height = Math.max(((endMin - startMin) / SLOT_MIN) * SLOT_PX, 18)
                  const style = CATEGORY_STYLE[categorize(e.subject)]
                  return (
                    <button
                      type="button"
                      onClick={() => setExternalDetail(e)}
                      key={`${e.calendarId ?? ''}:${e.id}`}
                      className={cn(
                        'absolute overflow-hidden rounded border px-1.5 py-0.5 text-left text-foreground',
                        e.showAs === 'free' && 'border-dashed',
                      )}
                      style={{
                        top,
                        height,
                        ...laneStyle(`calendar:${e.calendarId ?? ''}:${e.id}`),
                        background: Date.parse(e.endIso) <= now.getTime() ? 'var(--muted)' : 'var(--card)',
                        borderColor: e.showAs === 'free' ? style.dot : 'var(--border)',
                      }}
                      title={`${fmtTime(e.startIso, timezone)}–${fmtTime(e.endIso, timezone)} ${e.subject} (${calendarSource(e)})`}
                    >
                      <span className="block truncate text-micro font-medium leading-4">{e.subject}</span>
                      <span className="block truncate text-micro leading-4">{fmtTime(e.startIso, timezone)}–{fmtTime(e.endIso, timezone)} · Google</span>
                    </button>
                  )
                })}
                {events.map(a => {
                  const startMin = interval(a.startTime, a.endTime).start
                  const endMin = Math.min(
                    Math.max(interval(a.startTime, a.endTime).end, startMin + 15),
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
                      className={cn('absolute overflow-hidden rounded border px-1.5 py-0.5 text-left hover:brightness-95', a.calendarShowAsBusy === false && 'border-dashed')}
                      style={{
                        top,
                        height,
                        ...laneStyle(`appointment:${a.id}`),
                        background: a.calendarShowAsBusy === false ? 'var(--card)' : Date.parse(a.endTime) <= now.getTime() ? 'var(--muted)' : style.bg,
                        color: Date.parse(a.endTime) <= now.getTime() || a.calendarShowAsBusy === false ? 'var(--foreground)' : style.text,
                        borderLeft: `3px solid ${style.dot}`,
                      }}
                      title={`${fmtTime(a.startTime, timezone)}–${fmtTime(a.endTime, timezone)} ${a.typeLabel} — ${a.attendeeName}`}
                    >
                      <span className="block truncate text-micro font-medium leading-4">
                        {fmtTime(a.startTime, timezone)} {a.attendeeName}
                      </span>
                      {height >= 40 && showTypeLabel && (
                        <span className="block truncate text-micro leading-4">
                          {a.typeLabel}
                        </span>
                      )}
                      {matterChip && height >= 70 && (
                        <span className="mt-0.5 inline-block max-w-full truncate rounded-full border border-navy-12 bg-background/80 px-1.5 text-micro font-medium text-foreground">
                          ↗ {matterChip}
                        </span>
                      )}
                    </button>
                  )
                })}                {showNow && key === todayKey && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red" style={{ top: (nowMinutes - gridStartMin) / SLOT_MIN * SLOT_PX }}><span className="absolute -left-1 -top-1.5 h-2.5 w-2.5 rounded-full bg-red" /></div>}

              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
