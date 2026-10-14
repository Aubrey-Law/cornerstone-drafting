'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, Check, Circle, ExternalLink, FileText, Mail, NotebookPen, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { CalendarAppointment } from './types'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
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
  timezone = FIRM_TIMEZONE,
  onReschedule,
  onRemove,
  onAppointmentChanged,
  onBookNext,
}: {
  appointment: CalendarAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  authHeaders: () => HeadersInit | undefined
  timezone?: string
  onReschedule: (appointment: CalendarAppointment) => void
  /** Remove a meeting that was booked outside Cornerstone. Resolves false when the request failed. */
  onRemove?: (appointment: CalendarAppointment) => Promise<boolean> | boolean
  onAppointmentChanged?: (appointment: CalendarAppointment) => void
  onBookNext: (appointment: CalendarAppointment) => void
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [switchingTo, setSwitchingTo] = useState<VideoProvider | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const hasTeamsMeeting = appointment?.onlineMeetingProvider === 'microsoft_teams' && Boolean(appointment.onlineMeetingUrl)
  const hasGoogleMeet = Boolean(appointment?.onlineMeetingUrl) && !hasTeamsMeeting
  // Staff, not the client, pick the video service for a booked appointment;
  // switching updates the Google invite and emails the attendees.
  const canChangeVideo = Boolean(
    appointment &&
      appointment.status === 'scheduled' &&
      !isExternallyManagedSource(appointment.source) &&
      Date.parse(appointment.endTime) > Date.now(),
  )

  async function setVideoProvider(provider: VideoProvider) {
    if (!appointment) return
    const label = provider === 'microsoft_teams' ? 'Teams meeting' : 'Google Meet'
    setSwitchingTo(provider)
    try {
      const response = await fetch('/api/admin/scheduling/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          appointmentId: appointment.id,
          action: provider === 'microsoft_teams' ? 'add_teams_meeting' : 'use_google_meet',
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? `Could not add a ${label}`)
        return
      }
      onAppointmentChanged?.({
        ...appointment,
        onlineMeetingUrl: body.onlineMeetingUrl ?? null,
        onlineMeetingProvider: provider,
      })
      if (body.calendarUpdated === false) {
        toast.warning(`${label} created, but the Google Calendar invite could not be updated. Share the join link with the client.`)
      } else {
        toast.success(`${label} added. Attendees were sent the updated invite.`)
      }
    } catch {
      toast.error(`Could not add a ${label}`)
    } finally {
      setSwitchingTo(null)
    }
  }
  async function removeMeeting() {
    if (!appointment || !onRemove) return
    setRemoving(true)
    try {
      const ok = await onRemove(appointment)
      if (ok !== false) setConfirmingRemove(false)
    } finally {
      setRemoving(false)
    }
  }

  useEffect(() => {
    if (!open || !appointment) return
    setDetail(null)
    setDetailStatus('loading')
    setConfirmingRemove(false)
    const controller = new AbortController()
    void fetch(`/api/admin/calendar/events/${appointment.id}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then(body => {
        if (controller.signal.aborted) return
        setDetail(body)
        setDetailStatus('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setDetailStatus('error')
      })
    return () => controller.abort()
  }, [open, appointment, authHeaders])

  const categoryColor = appointment?.typeLabel.toLowerCase().includes('sign')
    ? 'var(--stage-done-bg)'
    : appointment?.typeLabel.toLowerCase().includes('draft')
      ? 'var(--stage-active-bg)'
      : 'var(--stage-work-bg)'
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {appointment && (
          <>
            <SheetHeader className="border-b border-border p-5" style={{ background: categoryColor }}>
              <span className="w-fit rounded-full bg-card/80 px-2 py-0.5 text-micro font-medium text-foreground">{appointment.typeLabel}</span>
              {appointment.calendarShowAsBusy === false && (
                <span className="w-fit rounded-full bg-green-bg px-2 py-0.5 text-micro font-medium text-green">
                  Free
                </span>
              )}
              <SheetTitle className="text-left text-lg">{appointment.attendeeName}{appointment.secondAttendeeName ? ` + ${appointment.secondAttendeeName}` : ''}</SheetTitle>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.startTime).toLocaleString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {appointment.locationType ? ` · ${appointment.locationType.replace('_', ' ')}` : ''}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {appointment.onlineMeetingUrl && <Button asChild size="sm"><a href={appointment.onlineMeetingUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />{hasTeamsMeeting ? 'Join Teams' : 'Join Meet'}</a></Button>}
                {canChangeVideo && !hasGoogleMeet && (
                  <Button size="sm" variant="outline" disabled={switchingTo !== null} onClick={() => void setVideoProvider('google_meet')}>
                    <Video className="mr-1 h-3.5 w-3.5" />
                    {switchingTo === 'google_meet' ? 'Adding Meet…' : hasTeamsMeeting ? 'Switch to Google Meet' : 'Add Google Meet'}
                  </Button>
                )}
                {canChangeVideo && !hasTeamsMeeting && (
                  <Button size="sm" variant="outline" disabled={switchingTo !== null} onClick={() => void setVideoProvider('microsoft_teams')}>
                    <Video className="mr-1 h-3.5 w-3.5" />
                    {switchingTo === 'microsoft_teams' ? 'Adding Teams…' : hasGoogleMeet ? 'Switch to Teams' : 'Add Teams meeting'}
                  </Button>
                )}
                {isExternallyManagedSource(appointment.source) ? (
                  <>
                    <span className="rounded-full bg-card/80 px-2 py-1 text-micro font-medium text-foreground">
                      Managed in {externalSourceLabel(appointment.source)}
                    </span>
                    {appointment.status === 'scheduled' && (
                      <Button size="sm" variant="outline" onClick={() => onReschedule(appointment)}>Reschedule</Button>
                    )}
                    {appointment.status === 'scheduled' && onRemove && (
                      confirmingRemove ? (
                        <>
                          <span className="text-micro text-foreground">Remove from Cornerstone? The client is not emailed.</span>
                          <Button size="sm" variant="destructive" disabled={removing} onClick={() => void removeMeeting()}>
                            {removing ? 'Removing…' : 'Remove meeting'}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={removing} onClick={() => setConfirmingRemove(false)}>Keep</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setConfirmingRemove(true)}>Remove…</Button>
                      )
                    )}
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onReschedule(appointment)}>Reschedule</Button>
                )}
                {appointment.linkedMatterId && <Button asChild size="sm" variant="outline"><Link href={`/admin/matters/${appointment.linkedMatterId}`}>Open matter</Link></Button>}
              </div>
            </SheetHeader>

            <div className="space-y-4 p-5">
              <ClientResponses appointment={appointment} />
              {detailStatus === 'error' ? <p className="text-sm text-muted-foreground" role="alert">Meeting context unavailable.</p> : !detail ? <p className="text-sm text-muted-foreground">Loading meeting context…</p> : (
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

type VideoProvider = 'google_meet' | 'microsoft_teams'

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-3"><h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>{children}</section>
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-muted p-2"><span className="block text-micro uppercase text-muted-foreground">{label}</span><span className="font-medium text-foreground">{value}</span></div>
}
