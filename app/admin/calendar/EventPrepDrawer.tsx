'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, Check, Circle, ExternalLink, FileText, Mail, NotebookPen, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { CalendarAppointment } from './types'
import { externalSourceLabel, isExternallyManagedSource } from '@/lib/appointments/types'

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
  onAppointmentChanged,
  onBookNext,
}: {
  appointment: CalendarAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  authHeaders: () => HeadersInit | undefined
  onReschedule: (appointment: CalendarAppointment) => void
  onAppointmentChanged?: (appointment: CalendarAppointment) => void
  onBookNext: (appointment: CalendarAppointment) => void
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [addingTeams, setAddingTeams] = useState(false)
  const hasTeamsMeeting = appointment?.onlineMeetingProvider === 'microsoft_teams' && Boolean(appointment.onlineMeetingUrl)
  const canAddTeams = Boolean(
    appointment &&
      appointment.status === 'scheduled' &&
      !hasTeamsMeeting &&
      !isExternallyManagedSource(appointment.source) &&
      Date.parse(appointment.endTime) > Date.now(),
  )

  async function addTeamsMeeting() {
    if (!appointment) return
    setAddingTeams(true)
    try {
      const response = await fetch('/api/admin/scheduling/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ appointmentId: appointment.id, action: 'add_teams_meeting' }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? 'Could not add a Teams meeting')
        return
      }
      onAppointmentChanged?.({
        ...appointment,
        onlineMeetingUrl: body.onlineMeetingUrl ?? null,
        onlineMeetingProvider: 'microsoft_teams',
      })
      if (body.calendarUpdated === false) {
        toast.warning('Teams meeting created, but the Google Calendar invite could not be updated. Share the join link with the client.')
      } else {
        toast.success('Teams meeting added. Attendees were sent the updated invite.')
      }
    } catch {
      toast.error('Could not add a Teams meeting')
    } finally {
      setAddingTeams(false)
    }
  }
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
              <span className="w-fit rounded-full bg-card/80 px-2 py-0.5 text-micro font-medium text-foreground">{appointment.typeLabel}</span>
              <span
                className={`w-fit rounded-full ${appointment?.calendarShowAsBusy === false ? 'bg-green-bg text-green' : 'bg-red-bg text-red'} px-2 py-0.5 text-micro font-medium`}
              >
                {calendarStatus}
              </span>
              <SheetTitle className="text-left text-lg">{appointment.attendeeName}{appointment.secondAttendeeName ? ` + ${appointment.secondAttendeeName}` : ''}</SheetTitle>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.startTime).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {appointment.locationType ? ` · ${appointment.locationType.replace('_', ' ')}` : ''}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {appointment.onlineMeetingUrl && <Button asChild size="sm"><a href={appointment.onlineMeetingUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />{hasTeamsMeeting ? 'Join Teams' : 'Join'}</a></Button>}
                {canAddTeams && (
                  <Button size="sm" variant="outline" disabled={addingTeams} onClick={() => void addTeamsMeeting()}>
                    <Video className="mr-1 h-3.5 w-3.5" />
                    {addingTeams ? 'Adding Teams…' : appointment.onlineMeetingUrl ? 'Switch to Teams' : 'Add Teams meeting'}
                  </Button>
                )}
                {isExternallyManagedSource(appointment.source) ? (
                  <span className="rounded-full bg-card/80 px-2 py-1 text-micro font-medium text-foreground">
                    Managed in {externalSourceLabel(appointment.source)}
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onReschedule(appointment)}>Reschedule</Button>
                )}
                {appointment.linkedMatterId && <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${appointment.linkedMatterId}`}>Open matter</Link></Button>}
              </div>
            </SheetHeader>

            <div className="space-y-4 p-5">
              <ClientResponses appointment={appointment} />
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
                        {item.blocker ? <span className="text-red">●</span> : item.status === 'done' ? <Check className="h-3.5 w-3.5 text-green" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
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
                        <span className="text-micro text-muted-foreground">{document.generation_id ? 'Generated version' : document.source}</span>
                      </Link>
                    )) : <p className="text-xs text-muted-foreground">No current documents found.</p>}
                  </DrawerSection>

                  <DrawerSection title="Attendees">
                    {detail.attendees.map(attendee => (
                      <div key={attendee.email} className="flex items-center justify-between border-b border-border py-2 text-xs last:border-0">
                        <span><span className="block font-medium text-foreground">{attendee.name}</span><span className="text-muted-foreground">{attendee.email}</span></span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground">{attendee.status}</span>
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

/**
 * What the client told us when booking: answers to the type's booking
 * questions (label as it read at booking time) and the free-text notes.
 * Comes with the appointment itself, so it renders before the context fetch.
 */
function ClientResponses({ appointment }: { appointment: CalendarAppointment }) {
  const answers = appointment.bookingAnswers ?? []
  const notes = appointment.notes?.trim()
  if (answers.length === 0 && !notes) return null
  return (
    // Staff-booked appointments carry the booker's notes, not the client's.
    <DrawerSection title={appointment.source === 'admin' ? 'Booking notes' : 'From the client'}>
      <dl className="space-y-2 text-xs">
        {answers.map(answer => (
          <div key={answer.questionId || answer.label}>
            <dt className="font-medium text-foreground">{answer.label}</dt>
            <dd className="mt-0.5 whitespace-pre-line text-muted-foreground">{answer.answer}</dd>
          </div>
        ))}
        {notes && (
          <div>
            <dt className="font-medium text-foreground">Notes</dt>
            <dd className="mt-0.5 whitespace-pre-line text-muted-foreground">{notes}</dd>
          </div>
        )}
      </dl>
    </DrawerSection>
  )
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-3"><h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>{children}</section>
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-muted p-2"><span className="block text-micro uppercase text-muted-foreground">{label}</span><span className="font-medium text-foreground">{value}</span></div>
}
