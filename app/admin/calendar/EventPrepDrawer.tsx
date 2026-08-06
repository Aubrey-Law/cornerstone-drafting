'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, Check, Circle, ExternalLink, FileText, Mail, NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { CalendarAppointment } from './types'

interface EventDetail {
  appointment: Record<string, unknown>
  matter: {
    id: string
    name: string
    number: string | null
    stage: string
    stageLabel: string
    planType: string | null
    estate: number
    maTaxExposure: number
    lastTouch: { title: string; created_at: string } | null
  } | null
  checklist: Array<{ id: string; title: string; status: string; blocker: boolean }>
  documents: Array<{ id: string; name: string; source: string; generation_id: string | null }>
  attendees: Array<{ name: string; email: string; status: string }>
}

function money(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function EventPrepDrawer({
  appointment,
  open,
  onOpenChange,
  authHeaders,
  onReschedule,
  onBookNext,
}: {
  appointment: CalendarAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  authHeaders: () => HeadersInit | undefined
  onReschedule: (appointment: CalendarAppointment) => void
  onBookNext: (appointment: CalendarAppointment) => void
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null)
  useEffect(() => {
    if (!open || !appointment) return
    setDetail(null)
    const controller = new AbortController()
    void fetch(`/api/admin/calendar/events/${appointment.id}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : null)
      .then(setDetail)
    return () => controller.abort()
  }, [open, appointment, authHeaders])

  const categoryColor = appointment?.typeLabel.toLowerCase().includes('sign')
    ? 'var(--stage-done-bg)'
    : appointment?.typeLabel.toLowerCase().includes('draft')
      ? 'var(--stage-active-bg)'
      : 'var(--stage-work-bg)'
  const calendarStatus = appointment?.calendarShowAsBusy === false ? 'Free' : 'Busy'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {appointment && (
          <>
            <SheetHeader className="border-b border-border p-5" style={{ background: categoryColor }}>
              <span className="w-fit rounded-full bg-card/80 px-2 py-0.5 text-[11px] font-medium text-foreground">{appointment.typeLabel}</span>
              <span
                className={`w-fit rounded-full ${appointment?.calendarShowAsBusy === false ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'} px-2 py-0.5 text-[11px] font-medium`}
              >
                {calendarStatus}
              </span>
              <SheetTitle className="text-left text-lg">{appointment.attendeeName}{appointment.secondAttendeeName ? ` + ${appointment.secondAttendeeName}` : ''}</SheetTitle>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {appointment.locationType ? ` · ${appointment.locationType.replace('_', ' ')}` : ''}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {appointment.onlineMeetingUrl && <Button asChild size="sm"><a href={appointment.onlineMeetingUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />Join</a></Button>}
                <Button size="sm" variant="outline" onClick={() => onReschedule(appointment)}>Reschedule</Button>
                {appointment.linkedMatterId && <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${appointment.linkedMatterId}`}>Open matter</Link></Button>}
              </div>
            </SheetHeader>

            <div className="space-y-4 p-5">
              {!detail ? <p className="text-sm text-muted-foreground">Loading meeting context…</p> : (
                <>
                  <DrawerSection title="Matter summary">
                    {detail.matter ? (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <Fact label="Matter" value={detail.matter.number ?? detail.matter.name} />
                        <Fact label="Stage" value={detail.matter.stageLabel} />
                        <Fact label="Plan" value={detail.matter.planType ?? 'Not set'} />
                        <Fact label="Estimated estate" value={detail.matter.estate ? money(detail.matter.estate) : 'Not set'} />
                        <Fact label="MA tax exposure" value={detail.matter.maTaxExposure ? money(detail.matter.maTaxExposure) : 'None estimated'} />
                        <Fact label="Last touch" value={detail.matter.lastTouch?.title ?? 'No recent activity'} />
                      </div>
                    ) : <p className="text-xs text-muted-foreground">This appointment is not linked to a matter.</p>}
                  </DrawerSection>

                  <DrawerSection title="Prep checklist">
                    {detail.checklist.length ? detail.checklist.map(item => (
                      <div key={item.id} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
                        {item.blocker ? <span className="text-red-700">●</span> : item.status === 'done' ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="flex-1 text-xs text-foreground">{item.title}</span>
                        {appointment.linkedMatterId && <Button asChild size="sm" variant="ghost"><Link href={`/admin/matters/${appointment.linkedMatterId}?tab=tasks`}>Resolve</Link></Button>}
                      </div>
                    )) : <p className="text-xs text-muted-foreground">No open prep tasks.</p>}
                  </DrawerSection>

                  <DrawerSection title="Bring to the meeting">
                    {detail.documents.length ? detail.documents.map(document => (
                      <Link key={document.id} href={`/admin/matters/${appointment.linkedMatterId}?tab=documents`} className="flex items-center gap-2 border-b border-border py-2 text-xs text-foreground last:border-0 hover:underline">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="flex-1">{document.name}</span>
                        <span className="text-[10px] text-muted-foreground">{document.generation_id ? 'Generated version' : document.source}</span>
                      </Link>
                    )) : <p className="text-xs text-muted-foreground">No current documents found.</p>}
                  </DrawerSection>

                  <DrawerSection title="Attendees">
                    {detail.attendees.map(attendee => (
                      <div key={attendee.email} className="flex items-center justify-between border-b border-border py-2 text-xs last:border-0">
                        <span><span className="block font-medium text-foreground">{attendee.name}</span><span className="text-muted-foreground">{attendee.email}</span></span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{attendee.status}</span>
                      </div>
                    ))}
                  </DrawerSection>

                  <DrawerSection title="After the meeting">
                    <div className="flex flex-wrap gap-2">
                      {appointment.linkedMatterId && <>
                        <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${appointment.linkedMatterId}?tab=notes`}><NotebookPen className="mr-1 h-3.5 w-3.5" />Log notes</Link></Button>
                        <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${appointment.linkedMatterId}?tab=engagement`}><Mail className="mr-1 h-3.5 w-3.5" />Send proposal</Link></Button>
                        <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${appointment.linkedMatterId}`}>Advance stage</Link></Button>
                      </>}
                      <Button size="sm" onClick={() => onBookNext(appointment)}><CalendarPlus className="mr-1 h-3.5 w-3.5" />Book next appointment</Button>
                    </div>
                  </DrawerSection>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-3"><h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>{children}</section>
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-muted p-2"><span className="block text-[10px] uppercase text-muted-foreground">{label}</span><span className="font-medium text-foreground">{value}</span></div>
}
