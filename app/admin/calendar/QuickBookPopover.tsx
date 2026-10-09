'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarPlus, Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { type BookingQuestion, MAX_ANSWER_LENGTH } from '@/lib/appointments/bookingQuestions'
import { normalizeBookingNames, splitDisplayName } from '@/lib/appointments/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import SlotPicker, { type SlotPickerLoadResult } from '@/components/scheduling/SlotPicker'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { cn } from '@/lib/utils'
import {
  LOCATION_LABEL,
  allowedFormats,
  type BookableType,
  type LocationType,
  type OpenSlot,
} from './types'

interface PersonResult {
  id: string
  kind: 'matter' | 'lead'
  recordId: string
  name: string
  email: string
  phone: string | null
  secondName: string | null
  secondEmail: string | null
}

type VideoProvider = 'google_meet' | 'microsoft_teams'

interface Draft {
  typeId: string
  locationType: LocationType
  videoProvider: VideoProvider
  attendeeFirstName: string
  attendeeLastName: string
  attendeeEmail: string
  attendeePhone: string
  secondAttendeeFirstName: string
  secondAttendeeLastName: string
  secondAttendeeEmail: string
  startIso: string
  /** Answers to the selected type's booking questions, by question id. */
  answers: Record<string, string>
}

/** Who the appointment is for, when booking from a lead or matter page. */
export interface QuickBookAttendee {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  secondFirstName?: string | null
  secondLastName?: string | null
  secondEmail?: string | null
}

/** The lead or matter the booking is made from; it is linked directly. */
export interface QuickBookLink {
  leadId?: string | null
  matterId?: string | null
}

/**
 * First/last for the form. A record that only has a whole display name in the
 * first-name slot is split so the last name is not left blank; staff can edit.
 */
function nameParts(first: string | null | undefined, last: string | null | undefined) {
  const firstName = first?.trim() ?? ''
  const lastName = last?.trim() ?? ''
  return lastName ? { firstName, lastName } : splitDisplayName(firstName)
}

function attendeeFields(attendee: QuickBookAttendee | null | undefined) {
  const client = nameParts(attendee?.firstName, attendee?.lastName)
  const second = nameParts(attendee?.secondFirstName, attendee?.secondLastName)
  return {
    attendeeFirstName: client.firstName,
    attendeeLastName: client.lastName,
    attendeeEmail: attendee?.email?.trim() ?? '',
    attendeePhone: attendee?.phone?.trim() ?? '',
    secondAttendeeFirstName: second.firstName,
    secondAttendeeLastName: second.lastName,
    secondAttendeeEmail: attendee?.secondEmail?.trim() ?? '',
  }
}

function initialDraft(types: BookableType[], prefillIso?: string | null, attendee?: QuickBookAttendee | null): Draft {
  return {
    typeId: types[0]?.id ?? '',
    locationType: allowedFormats(types[0])[0],
    videoProvider: 'google_meet',
    ...attendeeFields(attendee),
    startIso: prefillIso ?? '',
    answers: {},
  }
}

/** The record's client and spouse with names as stored first/last components. */
async function fetchRecordAttendee(
  record: QuickBookLink,
  authHeaders: () => HeadersInit | undefined,
  signal?: AbortSignal,
): Promise<QuickBookAttendee | null> {
  const param = record.leadId ? `leadId=${encodeURIComponent(record.leadId)}` : record.matterId ? `matterId=${encodeURIComponent(record.matterId)}` : null
  if (!param) return null
  try {
    const response = await fetch(`/api/admin/calendar/people?${param}`, { headers: authHeaders(), signal })
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    return body?.attendee ?? null
  } catch {
    return null
  }
}

/** "Mon, Oct 12 · 2:00 PM EDT" in the firm's time zone. */
export function formatSlotSummary(iso: string, timezone: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  return `${day} · ${time}`
}

function slotDetailText(slot: OpenSlot | undefined): string | null {
  if (!slot) return null
  const notes = [
    slot.afterHours ? 'after hours' : null,
    slot.meetingOrdinal >= 2 ? `meeting #${slot.meetingOrdinal} that day` : null,
  ].filter(Boolean)
  return notes.length > 0 ? notes.join(' · ') : null
}

export function QuickBookPopover({
  open,
  onOpenChange,
  types,
  prefillIso,
  authHeaders,
  onBooked,
  timezone = FIRM_TIMEZONE,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  types: BookableType[]
  prefillIso?: string | null
  timezone?: string
  authHeaders: () => HeadersInit | undefined
  onBooked: () => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <CalendarPlus className="mr-1 h-4 w-4" /> Quick book
          <kbd className="ml-2 rounded border border-primary-foreground/30 px-1 text-micro">⌘⇧K</kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Quick book</h2>
          <p className="text-xs text-muted-foreground">Choose a verified opening and email the confirmation.</p>
        </div>
        <QuickBookForm
          active={open}
          types={types}
          prefillIso={prefillIso}
          timezone={timezone}
          authHeaders={authHeaders}
          onBooked={() => {
            onOpenChange(false)
            onBooked()
          }}
          bodyClassName="max-h-[70vh]"
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The staff booking form: who, what, where, when (a month calendar like the
 * client sees), then client answers. Used by Quick book on the calendar and
 * by "Schedule appointment" on lead and matter pages.
 */
export function QuickBookForm({
  active,
  types,
  prefillIso,
  authHeaders,
  onBooked,
  timezone = FIRM_TIMEZONE,
  attendee,
  link,
  showSearch = true,
  bodyClassName,
}: {
  /** False while the surrounding popover or dialog is closed. */
  active: boolean
  types: BookableType[]
  prefillIso?: string | null
  timezone?: string
  authHeaders: () => HeadersInit | undefined
  onBooked: () => void
  attendee?: QuickBookAttendee | null
  link?: QuickBookLink | null
  /** Hide the contact search when the attendee is already known. */
  showSearch?: boolean
  bodyClassName?: string
}) {
  const open = active
  const [draft, setDraft] = useState<Draft>(() => initialDraft(types, prefillIso, attendee))
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<PersonResult[]>([])
  // The lead or matter picked from search, linked unless the email is edited.
  const [searchLink, setSearchLink] = useState<QuickBookLink | null>(null)
  // Stored names replace the prefill only until staff edit a name themselves.
  const namesEdited = useRef(false)
  // Every opening the picker has loaded, by start; only these can be booked.
  const [verifiedSlots, setVerifiedSlots] = useState<Map<string, OpenSlot>>(() => new Map())
  const [booking, setBooking] = useState(false)
  const [teamsConnected, setTeamsConnected] = useState(false)
  const selectedType = types.find(type => type.id === draft.typeId)
  const questions = selectedType?.bookingQuestions ?? []

  // Teams is offered only once Microsoft 365 is connected; otherwise the
  // choice would book a Meet anyway and surprise the attorney.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void fetch('/api/admin/microsoft/status', { headers: authHeaders(), signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => setTeamsConnected(Boolean(body?.connected && body?.hasTeamsScope)))
      .catch(() => {})
    return () => controller.abort()
  }, [open, authHeaders])

  useEffect(() => {
    if (!open) return
    setDraft(current => ({
      ...(current.typeId ? current : initialDraft(types, prefillIso, attendee)),
      startIso: prefillIso ?? current.startIso,
    }))
  }, [open, prefillIso, types, attendee])

  // Booking from a lead or matter page: replace the prefill's names with the
  // record's stored first/last components.
  const linkLeadId = link?.leadId ?? null
  const linkMatterId = link?.matterId ?? null
  useEffect(() => {
    if (!open || (!linkLeadId && !linkMatterId)) return
    const controller = new AbortController()
    void fetchRecordAttendee({ leadId: linkLeadId, matterId: linkMatterId }, authHeaders, controller.signal).then(stored => {
      if (!stored || controller.signal.aborted || namesEdited.current) return
      setDraft(current => ({ ...current, ...attendeeFields(stored) }))
    })
    return () => controller.abort()
  }, [open, linkLeadId, linkMatterId, authHeaders])

  useEffect(() => {
    if (!open || !showSearch || query.trim().length < 2) {
      setPeople([])
      return
    }
    const timer = window.setTimeout(() => {
      void fetch(`/api/admin/calendar/people?q=${encodeURIComponent(query.trim())}`, { headers: authHeaders() })
        .then(response => response.ok ? response.json() : { people: [] })
        .then(body => setPeople(body.people ?? []))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, showSearch, query, authHeaders])

  const { typeId, locationType } = draft
  const loadSlots = useCallback(async ({ from, to }: { from: Date; to: Date }): Promise<SlotPickerLoadResult> => {
    const params = new URLSearchParams({
      typeId,
      locationType,
      from: from.toISOString(),
      to: to.toISOString(),
    })
    if (prefillIso) params.set('preferred', prefillIso)
    const unavailable = 'Verified openings are unavailable. Check the calendar connection and try again.'
    try {
      const response = await fetch(`/api/admin/scheduling/slots?${params}`, { headers: authHeaders() })
      const body = await response.json().catch(() => ({}))
      const horizonDays = typeof body.horizonDays === 'number' ? body.horizonDays : undefined
      if (!response.ok) return { slots: [], horizonDays, error: body.error ?? unavailable }
      if (!body.connected) return { slots: [], horizonDays, error: unavailable }
      const opened: OpenSlot[] = body.slots ?? []
      setVerifiedSlots(current => {
        const next = new Map(current)
        for (const slot of opened) next.set(slot.startIso, slot)
        return next
      })
      return { slots: opened.map(slot => slot.startIso), horizonDays }
    } catch {
      return { slots: [], error: unavailable }
    }
  }, [typeId, locationType, prefillIso, authHeaders])

  // A different type or format has different openings: forget the old ones.
  useEffect(() => {
    setVerifiedSlots(new Map())
  }, [typeId, locationType])

  const slotDetail = useCallback((iso: string) => slotDetailText(verifiedSlots.get(iso)), [verifiedSlots])
  const onSelectSlot = useCallback((iso: string | null) => {
    setDraft(current => ({ ...current, startIso: iso ?? '' }))
  }, [])

  const slotVerified = Boolean(draft.startIso) && verifiedSlots.has(draft.startIso)

  async function submit() {
    if (!slotVerified) { toast.error('Choose a verified available slot'); return }
    if (!draft.attendeeEmail.trim() || !draft.typeId || !draft.startIso) {
      toast.error('Choose who, what, where, and when')
      return
    }
    try {
      normalizeBookingNames({ ...draft, firstName: draft.attendeeFirstName, lastName: draft.attendeeLastName })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Confirm attendee names')
      return
    }
    setBooking(true)
    try {
      const response = await fetch('/api/admin/scheduling/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          typeId: draft.typeId,
          locationType: draft.locationType,
          videoProvider: draft.locationType === 'teams' && teamsConnected ? draft.videoProvider : undefined,
          startIso: draft.startIso,
          attendeeFirstName: draft.attendeeFirstName,
          attendeeLastName: draft.attendeeLastName,
          attendeeEmail: draft.attendeeEmail.trim(),
          attendeePhone: draft.attendeePhone.trim() || undefined,
          secondAttendeeFirstName: draft.secondAttendeeFirstName.trim() || undefined,
          secondAttendeeLastName: draft.secondAttendeeLastName.trim() || undefined,
          secondAttendeeEmail: draft.secondAttendeeEmail.trim() || undefined,
          answers: draft.answers,
          linkedLeadId: (link ?? searchLink)?.leadId || undefined,
          linkedMatterId: (link ?? searchLink)?.matterId || undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? 'Booking failed')
        return
      }
      if (body.teamsMeetingError) {
        toast.warning(`Booked with Google Meet: the Teams meeting could not be created (${body.teamsMeetingError})`)
      } else {
        toast.success('Appointment booked — confirmation email sent')
      }
      setDraft(initialDraft(types, null, attendee))
      setQuery('')
      setSearchLink(null)
      namesEdited.current = false
      onBooked()
    } catch {
      toast.error('Booking failed')
    } finally {
      setBooking(false)
    }
  }

  return (
    <>
        <div className={cn('space-y-4 overflow-y-auto p-4', bodyClassName)}>
          <Step number="1" title="Who">
            {showSearch && <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search contacts, leads, or matters…" />
            </div>
            {people.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-md border border-border">
                {people.map(person => (
                  <button
                    key={person.id}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-accent"
                    onClick={() => {
                      const record = person.kind === 'lead' ? { leadId: person.recordId } : { matterId: person.recordId }
                      namesEdited.current = false
                      setDraft(current => ({
                        ...current,
                        ...attendeeFields({
                          firstName: person.name,
                          email: person.email,
                          phone: person.phone,
                          secondFirstName: person.secondName,
                          secondEmail: person.secondEmail,
                        }),
                      }))
                      setQuery(person.name)
                      setPeople([])
                      setSearchLink(record)
                      // The split above is instant; the stored components follow.
                      void fetchRecordAttendee(record, authHeaders).then(stored => {
                        if (!stored || namesEdited.current) return
                        setDraft(current => current.attendeeEmail.trim().toLowerCase() === (person.email ?? '').trim().toLowerCase()
                          ? { ...current, ...attendeeFields(stored) }
                          : current)
                      })
                    }}
                  >
                    <span><span className="block text-xs font-medium text-foreground">{person.name}</span><span className="text-micro text-muted-foreground">{person.email}</span></span>
                    <span className="text-micro uppercase text-muted-foreground">{person.kind}</span>
                  </button>
                ))}
              </div>
            )}
            </>}
            {draft.attendeeEmail && <p className="mt-1 text-micro text-green"><Check className="mr-1 inline h-3 w-3" />{[draft.attendeeFirstName, draft.attendeeLastName].filter(Boolean).join(' ')} · {draft.attendeeEmail}</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="quick-book-first-name">First name</Label>
                <Input id="quick-book-first-name" required maxLength={80} autoComplete="given-name"
                  value={draft.attendeeFirstName} onChange={event => { namesEdited.current = true; setDraft(current => ({ ...current, attendeeFirstName: event.target.value })) }} />
              </div>
              <div>
                <Label htmlFor="quick-book-last-name">Last name</Label>
                <Input id="quick-book-last-name" required maxLength={80} autoComplete="family-name"
                  value={draft.attendeeLastName} onChange={event => { namesEdited.current = true; setDraft(current => ({ ...current, attendeeLastName: event.target.value })) }} />
              </div>
              <div>
                <Label htmlFor="quick-book-email">Email</Label>
                <Input id="quick-book-email" type="email" required
                  value={draft.attendeeEmail} onChange={event => { setSearchLink(null); setDraft(current => ({ ...current, attendeeEmail: event.target.value })) }} />
              </div>
              <div>
                <Label htmlFor="quick-book-phone">Phone</Label>
                <Input id="quick-book-phone" type="tel"
                  value={draft.attendeePhone} onChange={event => setDraft(current => ({ ...current, attendeePhone: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="quick-book-spouse-first-name">Spouse/partner first name</Label>
                <Input id="quick-book-spouse-first-name" maxLength={80}
                  value={draft.secondAttendeeFirstName} onChange={event => { namesEdited.current = true; setDraft(current => ({ ...current, secondAttendeeFirstName: event.target.value })) }} />
              </div>
              <div>
                <Label htmlFor="quick-book-spouse-last-name">Spouse/partner last name</Label>
                <Input id="quick-book-spouse-last-name" maxLength={80}
                  value={draft.secondAttendeeLastName} onChange={event => { namesEdited.current = true; setDraft(current => ({ ...current, secondAttendeeLastName: event.target.value })) }} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="quick-book-spouse-email">Spouse/partner email</Label>
                <Input id="quick-book-spouse-email" type="email"
                  value={draft.secondAttendeeEmail} onChange={event => setDraft(current => ({ ...current, secondAttendeeEmail: event.target.value }))} />
              </div>
            </div>
          </Step>

          <Step number="2" title="What">
            <div className="flex flex-wrap gap-1.5">
              {types.map(type => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setDraft(current => ({
                    ...current,
                    typeId: type.id,
                    // Answers belong to a type's questions; a different type starts fresh.
                    answers: type.id === current.typeId ? current.answers : {},
                    locationType: allowedFormats(type).includes(current.locationType)
                      ? current.locationType
                      : allowedFormats(type)[0],
                    startIso: '',
                  }))}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', draft.typeId === type.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-accent')}
                >
                  {type.label} · {type.durationMinutes}m
                </button>
              ))}
            </div>
          </Step>

          <Step number="3" title="Where">
            <div className="flex flex-wrap gap-1.5">
              {allowedFormats(selectedType).map(format => (
                <button
                  key={format}
                  type="button"
                  onClick={() => setDraft(current => ({ ...current, locationType: format, startIso: '' }))}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', draft.locationType === format ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-accent')}
                >
                  {LOCATION_LABEL[format]}
                </button>
              ))}
            </div>
            {draft.locationType === 'teams' && teamsConnected && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-micro text-muted-foreground">Video:</span>
                {([
                  ['google_meet', 'Google Meet'],
                  ['microsoft_teams', 'Microsoft Teams'],
                ] as const).map(([provider, label]) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => setDraft(current => ({ ...current, videoProvider: provider }))}
                    className={cn('rounded-full border px-2.5 py-1 text-xs', draft.videoProvider === provider ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-accent')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </Step>

          <Step number="4" title="When">
            <div className="overflow-hidden rounded-lg border border-border">
              {/* Remounts per type and format so the calendar opens fresh. */}
              <SlotPicker
                key={`${typeId}:${locationType}`}
                loadSlots={loadSlots}
                slotDetail={slotDetail}
                selected={draft.startIso || null}
                onSelect={onSelectSlot}
              />
            </div>
          </Step>

          {questions.length > 0 && (
            <Step number="5" title="Client answers">
              <p className="mb-2 text-micro text-muted-foreground">
                Optional when booking for a client; anything you fill in is saved with the appointment.
              </p>
              <div className="space-y-2.5">
                {questions.map(question => (
                  <QuestionField
                    key={question.id}
                    question={question}
                    value={draft.answers[question.id] ?? ''}
                    onChange={value => setDraft(current => ({ ...current, answers: { ...current.answers, [question.id]: value } }))}
                  />
                ))}
              </div>
            </Step>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className={cn('text-xs', slotVerified ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {slotVerified ? formatSlotSummary(draft.startIso, timezone) : 'Choose a verified slot'}
          </span>
          <Button size="sm" disabled={booking || !slotVerified || !draft.attendeeEmail || !draft.attendeeFirstName.trim() || !draft.attendeeLastName.trim()} onClick={() => void submit()}>
            {booking ? 'Booking…' : 'Book & email confirmation'}
          </Button>
        </div>
    </>
  )
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: BookingQuestion
  value: string
  onChange: (value: string) => void
}) {
  const id = `quick-book-question-${question.id}`
  const label = (
    <Label htmlFor={id}>
      {question.label}
      {question.required && <span className="font-normal text-muted-foreground">(required for clients)</span>}
    </Label>
  )
  if (question.kind === 'choice' || question.kind === 'yes_no') {
    const options = question.kind === 'yes_no' ? ['Yes', 'No'] : question.options
    return (
      <div>
        {label}
        <NativeSelect id={id} className="mt-1 h-8" value={value} onChange={event => onChange(event.target.value)}>
          <option value="">Not answered</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </NativeSelect>
      </div>
    )
  }
  return (
    <div>
      {label}
      {question.kind === 'long_text' ? (
        <Textarea id={id} className="mt-1 text-sm" rows={2} maxLength={MAX_ANSWER_LENGTH.long_text}
          value={value} onChange={event => onChange(event.target.value)} />
      ) : (
        <Input id={id} className="mt-1 h-8" maxLength={MAX_ANSWER_LENGTH.short_text}
          value={value} onChange={event => onChange(event.target.value)} />
      )}
    </div>
  )
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-1.5 text-xs font-semibold text-foreground"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-muted text-micro">{number}</span>{title}</h3>{children}</section>
}
