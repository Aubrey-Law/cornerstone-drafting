import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { fetchCalendarSnapshot } from '@/lib/appointments/calendarSnapshot'
import { mapCalendarView } from '@/lib/appointments/googleEvents'
import { FIRM_TIMEZONE, firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type { TodayAppointment } from '@/lib/queries/today'
import { RefreshTodayCalendar } from './RefreshTodayCalendar'
const time = new Intl.DateTimeFormat('en-US', { hour:'numeric',minute:'2-digit',timeZone:FIRM_TIMEZONE })
export function TodayCalendarCard({ rows, status }: { rows: TodayAppointment[]; status: string }) {
  return <section className="rounded-lg border border-border bg-card">
    <header className="flex items-center gap-2 border-b border-border px-3 py-2.5"><CalendarClock className="size-4" /><h2 className="text-sm font-semibold">Your day</h2></header>
    <p className="px-3 pt-2 text-xs text-muted-foreground">{status}</p>
    {rows.length > 0 && <ul className="divide-y divide-border">{rows.slice(0,4).map(row => <li key={row.id}><Link href={row.href} className="block px-3 py-2 text-sm hover:bg-muted/50">
      <span className="font-medium">{row.is_all_day ? 'All day' : time.format(new Date(row.next_appointment))}</span> · {row.client_name ?? 'Appointment'}{row.next_appointment_type && ` · ${row.next_appointment_type}`}
    </Link></li>)}</ul>}
    <div className="flex justify-between border-t px-3 py-2"><Link href="/admin/calendar" className="text-xs underline">Open calendar{rows.length > 4 ? ` (${rows.length} events)` : ''}</Link><RefreshTodayCalendar /></div>
  </section>
}
export async function TodayCalendar({ appointments, excludeIds, appointmentsError = false }: { appointments: TodayAppointment[]; excludeIds: string[]; appointmentsError?: boolean }) {
  const day=firmTodayKey(), noon=Date.parse(`${day}T12:00:00Z`)
  try {
    const snapshot=await fetchCalendarSnapshot(day,new Date(noon-18*3600000).toISOString(),new Date(noon+18*3600000).toISOString())
    const events=mapCalendarView(snapshot.result.raw,new Set(excludeIds)).filter(event => (event.isAllDay ? event.startIso.slice(0,10) : firmDateKey(event.startIso)) === day)
    const rows=[...appointments,...events.map(event => ({ id:`calendar:${event.id}`,matter_id:null,client_name:event.subject,next_appointment:event.startIso,next_appointment_type:'Calendar',href:'/admin/calendar',is_all_day:event.isAllDay }))].sort((a,b)=>a.next_appointment.localeCompare(b.next_appointment))
    const incomplete=appointmentsError || snapshot.result.truncated || snapshot.result.skipped.length > 0
    const status=`${snapshot.stale ? 'Saved calendar snapshot' : 'Updated'} ${time.format(new Date(snapshot.fetchedAt))}${incomplete ? ' · Some calendars or events unavailable' : rows.length === 0 ? ' · Nothing scheduled today' : ''}`
    return <TodayCalendarCard rows={rows} status={status} />
  } catch {
    return <TodayCalendarCard rows={appointments} status={appointmentsError ? 'Calendar unavailable. Refresh to retry.' : 'Google Calendar is unavailable. Showing recorded appointments; refresh to retry.'} />
  }
}
