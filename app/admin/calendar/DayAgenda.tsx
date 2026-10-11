'use client'

import Link from 'next/link'
import { AttentionBand } from './AttentionBand'
import {
  CalendarDays,
  Check,
  FileText,
  Video,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isExternallyManagedSource } from '@/lib/appointments/types'
import { bookedMinutes, dateInstant, intervalMinutes, openGaps } from '@/lib/calendarAvailability'
import { firmTodayKey, FIRM_TIMEZONE } from '@/lib/firmDate'
import type {
  DayAvailability,
  AttentionItem,
  CalendarAppointment,
  CalendarRailData,
  ExternalCalendarEvent,
} from './types'
import {
  BLOCK_HATCH,
  CATEGORY_LABEL,
  categorize,
  categoryStyleFor,
  isBlock,
} from './eventCategories'

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours}h` : '', rest ? `${rest}m` : ''].filter(Boolean).join(' ') || '0m'
}

function CalendarEventRow({ event, overlap, timezone }: { event: ExternalCalendarEvent; overlap: boolean; timezone: string }) {
  const style = categoryStyleFor(event.subject)
  return <div className="flex gap-3 rounded border border-border bg-card p-3 text-xs text-foreground" style={{ borderLeft: `3px solid ${style.dot}` }}>
    <span className="shrink-0 text-muted-foreground">{event.isAllDay ? 'All day' : new Date(event.startIso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })}</span>
    <div className="min-w-0"><p className="font-medium">{event.subject}</p><p className="text-muted-foreground">Google · {event.calendarName ?? 'Calendar'}{event.showAs === 'free' ? ' · Free' : ''}</p>{overlap && <p className="text-muted-foreground">Overlaps another event</p>}</div>
  </div>
}

function AgendaRow({
  appointment,
  onOpen,
  onReschedule,
  now, overlap, timezone,
}: {
  now: Date
  overlap: boolean
  timezone: string
  appointment: CalendarAppointment
  onOpen: () => void
  onReschedule: () => void
}) {
  const past = Date.parse(appointment.endTime) < now.getTime()
  const followUpReady = now.getTime() >= Date.parse(appointment.endTime) + 10 * 60_000
  const minutes = Math.max(0, Math.round((Date.parse(appointment.endTime) - Date.parse(appointment.startTime)) / 60_000))
  const status = appointment.status === 'no_show' ? 'No-show' : appointment.status === 'cancelled' ? 'Cancelled' : appointment.status === 'rescheduled' ? 'Rescheduled' : past ? 'Meeting ended' : Date.parse(appointment.startTime) <= now.getTime() ? 'In progress' : null
  const category = categorize(appointment.typeLabel)
  const categoryStyle = categoryStyleFor(appointment.typeLabel)
  return (
    <div className={cn('flex gap-3', past && 'bg-muted')}>
      <div className="w-[62px] shrink-0 pt-2 text-right">
        <div className="text-xs font-semibold tabular-nums text-foreground">{new Date(appointment.startTime).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })}</div>
        <div className="text-micro text-muted-foreground">{minutesLabel(minutes)}</div>
      </div>
      <article
        className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        style={{ borderLeft: `3px solid ${categoryStyle.dot}` }}
      >
        <div className="px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onOpen}
                className={cn('truncate text-left text-sm font-semibold text-foreground hover:underline', past && 'line-through')}
              >
                {appointment.attendeeName}
              </button>
              <p className="text-xs text-muted-foreground">
                {appointment.typeLabel}
                {appointment.locationType ? ` · ${appointment.locationType.replace('_', ' ')}` : ''}

              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full px-2 py-0.5 text-micro" style={{ background: categoryStyle.bg, color: categoryStyle.text }}><span>{CATEGORY_LABEL[category]}</span></span>
              {appointment.linkedMatterNumber && (
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-micro text-foreground">
                  {appointment.linkedMatterNumber}
                </span>
              )}
              {appointment.linkedMatterStage && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-micro"
                  style={{ background: 'var(--stage-active-bg)', color: 'var(--stage-active-text)' }}
                >
                  {appointment.linkedMatterStage.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>
          {overlap && <p className="mt-2 text-xs text-muted-foreground">Overlaps another event</p>}
          {!appointment.calendarSynced && appointment.status === 'scheduled' && !isExternallyManagedSource(appointment.source) && <p className="mt-2 rounded border border-amber-strong-border bg-amber-bg p-2 text-xs text-foreground">Not synced to Google Calendar. External bookings may not reflect this appointment.</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-micro">
            {status && <span className="text-muted-foreground">{status}</span>}
            <span className="ml-auto flex flex-wrap gap-1">
              {appointment.linkedMatterId && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/admin/matters/${appointment.linkedMatterId}`}>Open matter</Link>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onOpen}>
                <FileText className="mr-1 h-3 w-3" /> Prep pack
              </Button>
              {!past && appointment.status === 'scheduled' && !isExternallyManagedSource(appointment.source) && (
                <Button size="sm" variant="ghost" onClick={onReschedule}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Reschedule
                </Button>
              )}
              {appointment.onlineMeetingUrl && appointment.status === 'scheduled' && !past && (
                <Button asChild size="sm">
                  <a href={appointment.onlineMeetingUrl} target="_blank" rel="noreferrer">
                    <Video className="mr-1 h-3 w-3" /> Join
                  </a>
                </Button>
              )}
              {followUpReady && (
                <Button size="sm" variant="outline" onClick={onOpen}>
                  After-meeting actions
                </Button>
              )}
            </span>
          </div>
        </div>
      </article>
    </div>
  )
}

export function DayAgenda({
  date, appointments, calendarEvents, attention, rail, onDismissAttention, onOpenAppointment, onReschedule, onBookSlot,
  now = new Date(), todayKey = firmTodayKey(now), timezone = FIRM_TIMEZONE, availability = null,
  totalAppointments, totalCalendarEvents, attentionUnavailable = false, conflictAppointments = appointments, conflictCalendarEvents = calendarEvents,
}: {
  date: Date
  appointments: CalendarAppointment[]
  calendarEvents: ExternalCalendarEvent[]
  attention: AttentionItem[]
  rail: CalendarRailData
  onDismissAttention: (id: string) => void
  onOpenAppointment: (appointment: CalendarAppointment) => void
  onReschedule: (appointment: CalendarAppointment) => void
  onBookSlot: (startIso?: string) => void
  now?: Date
  todayKey?: string
  timezone?: string
  availability?: DayAvailability | null
  attentionUnavailable?: boolean
  conflictAppointments?: CalendarAppointment[]
  conflictCalendarEvents?: ExternalCalendarEvent[]
  totalAppointments?: number
  totalCalendarEvents?: number
}) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const isToday = key === todayKey
  const active = appointments.filter(item => item.status !== 'cancelled')
  const blocks = calendarEvents.filter(isBlock)
  const external = calendarEvents.filter(event => !isBlock(event))
  const gaps = availability?.date === key ? openGaps(availability.windows, availability.busy, isToday ? now.getTime() : key < todayKey ? Infinity : -Infinity, availability.bufferMinutes) : null
  const time = (instant: number) => new Date(instant).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
  const next = active.filter(item => item.status === 'scheduled' && Date.parse(item.startTime) > now.getTime()).sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
  const events = [...conflictAppointments.map(item => ({ id: `a:${item.id}`, start: Date.parse(item.startTime), end: Date.parse(item.endTime), busy: item.status === 'scheduled' && item.calendarShowAsBusy !== false })), ...conflictCalendarEvents.map(item => ({ id: `g:${item.id}`, start: item.isAllDay ? dateInstant(item.startIso.slice(0, 10), timezone) : Date.parse(item.startIso), end: item.isAllDay ? dateInstant(item.endIso.slice(0, 10), timezone) : Date.parse(item.endIso), busy: item.showAs !== 'free' }))]
  const overlaps = (id: string) => { const event = events.find(item => item.id === id); return !!event?.busy && events.some(other => other.id !== id && other.busy && event.start < other.end && event.end > other.start) }
  const rows = [
    ...active.map(item => ({ id: `a:${item.id}`, start: Date.parse(item.startTime), node: <AgendaRow appointment={item} now={now} timezone={timezone} overlap={overlaps(`a:${item.id}`)} onOpen={() => onOpenAppointment(item)} onReschedule={() => onReschedule(item)} /> })),
    ...external.map(item => ({ id: `g:${item.id}`, start: item.isAllDay ? -Infinity : Date.parse(item.startIso), node: <CalendarEventRow event={item} timezone={timezone} overlap={overlaps(`g:${item.id}`)} /> })),
    ...blocks.map(item => ({ id: `b:${item.id}`, start: item.isAllDay ? -Infinity : Date.parse(item.startIso), node: <div className="rounded border border-border px-3 py-2 text-xs text-foreground" style={{ backgroundImage: BLOCK_HATCH }}>{item.isAllDay ? 'All day' : time(Date.parse(item.startIso))} · <span>{item.subject}</span></div> })),
    ...(gaps ?? []).filter(gap => gap.end - gap.start >= 30 * 60_000).map(gap => ({ id: `gap:${gap.start}`, start: gap.start, node: <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-border bg-card p-3 text-xs text-foreground"><span>Open · {time(gap.start)}–{time(gap.end)} · {minutesLabel((gap.end - gap.start) / 60_000)}</span><Button size="sm" variant="outline" onClick={() => onBookSlot(new Date(gap.start).toISOString())}>Book</Button></div> })),
    ...(isToday ? [{ id: 'now', start: now.getTime(), node: <div className="border-t-2 border-red pt-1 text-xs font-medium text-red">{time(now.getTime())} · Now{next ? ` · ${next.attendeeName} in ${Math.ceil((Date.parse(next.startTime) - now.getTime()) / 60_000)} min` : ''}</div> }] : []),
  ].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_268px]">
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">{totalAppointments ?? active.filter(item => item.status === 'scheduled').length} appointments · {totalCalendarEvents ?? external.length} calendar events · {availability ? `${minutesLabel(bookedMinutes(availability.windows, availability.busy))} booked${key < todayKey ? ' · past day' : ` · ${minutesLabel(intervalMinutes(gaps ?? []))} open${isToday ? ' for the rest of today' : ' during working hours'}`}` : 'Availability unavailable'} · totals before category filters</p>
      <AttentionBand items={attention} onDismiss={onDismissAttention} />
      {attentionUnavailable && <p className="text-xs text-muted-foreground" role="status">Attention items unavailable</p>}
      <div className="space-y-2">{rows.map(row => <div key={row.id}>{row.node}</div>)}
        {!rows.length && <p className="rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing scheduled. Use Quick book to check availability.</p>}
      </div>
      <p className="text-xs text-muted-foreground">← → previous / next day · ? all shortcuts</p>
    </div>
    <aside className="space-y-3">
      <RailSection icon={CalendarDays} title="Dates this week">
        {rail.datesThisWeek.length ? rail.datesThisWeek.map(item => <Link key={item.id} href={`/admin/matters/${item.matterId}`} className="block rounded px-2 py-1.5 hover:bg-accent"><span className="block text-xs font-medium text-foreground">{item.label}</span><span className="text-micro text-muted-foreground">{item.date.slice(0, 10)}</span></Link>) : <Empty>Nothing due this week</Empty>}
      </RailSection>
      <RailSection icon={Check} title="Follow-ups owed">
        {rail.followUps.length ? rail.followUps.map(item => <Link key={item.id} href={item.matterId ? `/admin/matters/${item.matterId}?tab=tasks` : `/admin/crm/opportunities/${item.leadId}`} className="block rounded px-2 py-1.5 text-xs text-foreground hover:bg-accent">{item.title}</Link>) : <Empty>No follow-ups owed</Empty>}
      </RailSection>
    </aside>
  </div>
}

function RailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CalendarDays
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {title}
      </h2>
      <div className="p-1">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-xs text-muted-foreground">{children}</p>
}
