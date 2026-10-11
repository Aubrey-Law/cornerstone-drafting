'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AttentionBand } from './AttentionBand'
import { LoadIndicator } from './LoadIndicator'
import type { AttentionItem, CalendarAppointment, ExternalCalendarEvent, PlanData, OpenSlot } from './types'
import { isBlock } from './eventCategories'

export function WeekStrip({ days, selectedDay, todayKey, counts, onSelect }: {
  days: PlanData['days']; selectedDay: string; todayKey: string; counts: Map<string, number>; onSelect: (key: string) => void
}) {
  return <div>
    <nav aria-label="Days this week" className="overflow-x-auto rounded-md">
      <div className="grid min-w-[560px] grid-cols-7 gap-1">{days.map(day => <button key={day.date} type="button" aria-pressed={selectedDay === day.date} onClick={() => onSelect(day.date)} className={cn('min-w-[80px] rounded-md border bg-card p-2 text-center text-xs text-foreground', selectedDay === day.date ? 'border-primary ring-2 ring-primary/30' : day.date === todayKey ? 'border-foreground' : 'border-border')}>
        <span className="block font-medium">{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</span>
        {day.date === todayKey && <span className="text-micro">Today</span>}
        <LoadIndicator day={Number.isFinite(day.targetMinutes) ? day : undefined} count={counts.get(day.date) ?? 0} />
      </button>)}</div>
    </nav>
    <p className="mt-1 text-micro text-muted-foreground lg:hidden">Scroll sideways for the rest of the week.</p>
  </div>
}

export function NextUp({ date, todayKey, now, appointments, visibleAppointments = appointments, calendarEvents, attention, attentionUnavailable = false, slots, availabilityState, onDismiss, onOpen, onBook, timezone }: {
  date: string; todayKey: string; now: Date; appointments: CalendarAppointment[]; visibleAppointments?: CalendarAppointment[]; calendarEvents: ExternalCalendarEvent[]; attention: AttentionItem[]; attentionUnavailable?: boolean; slots: OpenSlot[]; availabilityState: string; timezone: string
  onDismiss: (id: string) => void; onOpen: (appointment: CalendarAppointment) => void; onBook: (iso: string) => void
}) {
  const meetings = appointments.filter(item => item.status === 'scheduled').sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
  const next = date < todayKey ? undefined : meetings.find(item => date !== todayKey || Date.parse(item.endTime) > now.getTime())
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
  const later = [...visibleAppointments.filter(item => item.status === 'scheduled').filter(item => item !== next && (date !== todayKey || Date.parse(item.startTime) > now.getTime())).map(item => ({ id: `a:${item.id}`, start: item.startTime, label: item.attendeeName, appointment: item })), ...calendarEvents.filter(item => !isBlock(item) && (date !== todayKey || Date.parse(item.startIso) > now.getTime())).map(item => ({ id: `g:${item.id}`, start: item.startIso, label: `${item.subject} · Google`, appointment: null }))].sort((a, b) => a.start.localeCompare(b.start))
  return <section className="space-y-3 rounded-lg border border-border bg-card p-4">
    <h2 className="text-base font-semibold text-foreground">Next up</h2>
    <p className="text-xs text-muted-foreground">{new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    {next ? <article className="space-y-2 rounded border border-border p-3">
      <h3 className="text-sm font-semibold text-foreground">{next.attendeeName}</h3>
      <p className="text-xs text-muted-foreground">{time(next.startTime)} · {date === todayKey ? Date.parse(next.startTime) <= now.getTime() ? 'In progress' : `in ${Math.ceil((Date.parse(next.startTime) - now.getTime()) / 60_000)} min` : next.typeLabel}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onOpen(next)}>Prep pack</Button>
        {next.onlineMeetingUrl ? <Button asChild size="sm"><a href={next.onlineMeetingUrl} target="_blank" rel="noreferrer">Join</a></Button> : next.linkedMatterId && <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${next.linkedMatterId}`}>Open matter</Link></Button>}
      </div>
    </article> : <p className="text-sm text-muted-foreground">{date < todayKey ? 'Past day · meeting history below' : 'No upcoming meetings on this day'}</p>}
    <AttentionBand items={attention} onDismiss={onDismiss} compact />
    {attentionUnavailable && <p className="text-xs text-muted-foreground">Attention items unavailable</p>}
    <h3 className="text-sm font-medium text-foreground">{date === todayKey ? 'Later today' : 'Other events'}</h3>
    {later.length ? later.map(item => <div key={item.id} className="text-xs text-foreground">{time(item.start)} · {item.appointment ? <button className="underline" onClick={() => onOpen(item.appointment!)}>{item.label}</button> : item.label}</div>) : <p className="text-xs text-muted-foreground">No other events</p>}
    <h3 className="text-sm font-medium text-foreground">Verified openings</h3>
    {availabilityState !== 'ready' ? <p className="text-xs text-muted-foreground">{availabilityState === 'loading' ? 'Checking availability…' : 'Availability unavailable'}</p> : slots.length ? slots.slice(0, 5).map(slot => <div key={slot.startIso} className="flex items-center justify-between gap-2 text-xs text-foreground"><span>{time(slot.startIso)}</span><Button size="sm" variant="outline" onClick={() => onBook(slot.startIso)}>Book</Button></div>) : <p className="text-xs text-muted-foreground">No verified slots for the default appointment type</p>}
  </section>
}
