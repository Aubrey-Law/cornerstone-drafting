'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { type BookingQuestion, MAX_ANSWER_LENGTH } from '@/lib/appointments/bookingQuestions'
import { normalizeBookingNames } from '@/lib/appointments/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

function initialDraft(types: BookableType[], prefillIso?: string | null): Draft {
  return {
    typeId: types[0]?.id ?? '',
    locationType: allowedFormats(types[0])[0],
    videoProvider: 'google_meet',
    attendeeFirstName: '',
    attendeeLastName: '',
    attendeeEmail: '',
    attendeePhone: '',
    secondAttendeeFirstName: '',
    secondAttendeeLastName: '',
    secondAttendeeEmail: '',
    startIso: prefillIso ?? '',
    answers: {},
  }
}

function nextThreeWorkingDayRange(prefillIso?: string | null) {
  const from = prefillIso ? new Date(prefillIso) : new Date()
  from.setMinutes(0, 0, 0)
  const to = new Date(from)
  let working = 0
  while (working < 3) {
    to.setDate(to.getDate() + 1)
    if (to.getDay() !== 0 && to.getDay() !== 6) working += 1
  }
  to.setHours(23, 59, 59, 999)
  return { from, to }
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
  const [draft, setDraft] = useState<Draft>(() => initialDraft(types, prefillIso))
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<PersonResult[]>([])
  const [slots, setSlots] = useState<OpenSlot[]>([])
  const [connected, setConnected] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
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
      ...(current.typeId ? current : initialDraft(types, prefillIso)),
      startIso: prefillIso ?? current.startIso,
    }))
  }, [open, prefillIso, types])

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setPeople([])
      return
    }
    const timer = window.setTimeout(() => {
      void fetch(`/api/admin/calendar/people?q=${encodeURIComponent(query.trim())}`, { headers: authHeaders() })
        .then(response => response.ok ? response.json() : { people: [] })
        .then(body => setPeople(body.people ?? []))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [open, query, authHeaders])

  const range = useMemo(() => nextThreeWorkingDayRange(prefillIso), [prefillIso])
  useEffect(() => {
    if (!open || !draft.typeId || !draft.locationType) return
    const controller = new AbortController()
    setLoadingSlots(true)
    setSlots([])
    setConnected(false)
    const params = new URLSearchParams({
      typeId: draft.typeId,
      locationType: draft.locationType,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    })
    if (prefillIso) params.set('preferred', prefillIso)
    void fetch(`/api/admin/scheduling/slots?${params}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : { connected: false, slots: [] })
      .then(body => {
        if (controller.signal.aborted) return
        setSlots(body.slots ?? [])
        setConnected(Boolean(body.connected))
      })
      .catch(() => { if (!controller.signal.aborted) { setSlots([]); setConnected(false) } })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false) })
    return () => controller.abort()
  }, [open, draft.typeId, draft.locationType, range, authHeaders, prefillIso])

  async function submit() {
    if (loadingSlots || !connected || !slots.some(slot => slot.startIso === draft.startIso)) { toast.error('Choose a verified available slot'); return }
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
      onOpenChange(false)
      setDraft(initialDraft(types, null))
      setQuery('')
      onBooked()
    } catch {
      toast.error('Booking failed')
    } finally {
      setBooking(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <CalendarPlus className="mr-1 h-4 w-4" /> Quick book
          <kbd className="ml-2 rounded border border-primary-foreground/30 px-1 text-micro">⌘⇧K</kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Quick book</h2>
          <p className="text-xs text-muted-foreground">Choose a verified opening and email the confirmation.</p>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <Step number="1" title="Who">
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
                      setDraft(current => ({
                        ...current,
                        attendeeFirstName: person.name ?? '',
                        attendeeLastName: '',
                        attendeeEmail: person.email ?? '',
                        attendeePhone: person.phone ?? '',
                        secondAttendeeFirstName: person.secondName ?? '',
                        secondAttendeeLastName: '',
                        secondAttendeeEmail: person.secondEmail ?? '',
                      }))
                      setQuery(person.name)
                      setPeople([])
                    }}
                  >
                    <span><span className="block text-xs font-medium text-foreground">{person.name}</span><span className="text-micro text-muted-foreground">{person.email}</span></span>
                    <span className="text-micro uppercase text-muted-foreground">{person.kind}</span>
                  </button>
                ))}
              </div>
            )}
            {draft.attendeeEmail && <p className="mt-1 text-micro text-green"><Check className="mr-1 inline h-3 w-3" />{[draft.attendeeFirstName, draft.attendeeLastName].filter(Boolean).join(' ')} · {draft.attendeeEmail}</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="quick-book-first-name">First name</Label>
                <Input id="quick-book-first-name" required maxLength={80} autoComplete="given-name"
                  value={draft.attendeeFirstName} onChange={event => setDraft(current => ({ ...current, attendeeFirstName: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="quick-book-last-name">Last name</Label>
                <Input id="quick-book-last-name" required maxLength={80} autoComplete="family-name"
                  value={draft.attendeeLastName} onChange={event => setDraft(current => ({ ...current, attendeeLastName: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="quick-book-email">Email</Label>
                <Input id="quick-book-email" type="email" required
                  value={draft.attendeeEmail} onChange={event => setDraft(current => ({ ...current, attendeeEmail: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="quick-book-phone">Phone</Label>
                <Input id="quick-book-phone" type="tel"
                  value={draft.attendeePhone} onChange={event => setDraft(current => ({ ...current, attendeePhone: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="quick-book-spouse-first-name">Spouse/partner first name</Label>
                <Input id="quick-book-spouse-first-name" maxLength={80}
                  value={draft.secondAttendeeFirstName} onChange={event => setDraft(current => ({ ...current, secondAttendeeFirstName: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="quick-book-spouse-last-name">Spouse/partner last name</Label>
                <Input id="quick-book-spouse-last-name" maxLength={80}
                  value={draft.secondAttendeeLastName} onChange={event => setDraft(current => ({ ...current, secondAttendeeLastName: event.target.value }))} />
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
            {!connected ? (
              <p className="rounded-md border border-amber-strong-border bg-amber-bg p-2 text-xs text-foreground">
                Verified openings are unavailable. Check the calendar connection and try again.
              </p>
            ) : loadingSlots ? (
              <p className="text-xs text-muted-foreground">Checking the calendar and appointment buffers…</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {slots.slice(0, 14).map(slot => (
                  <SlotButton timezone={timezone} key={slot.startIso} slot={slot} selected={draft.startIso === slot.startIso} onClick={() => setDraft(current => ({ ...current, startIso: slot.startIso }))} />
                ))}
              </div>
            )}
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
          <span className="text-micro text-muted-foreground">{draft.startIso ? new Date(draft.startIso).toLocaleString('en-US', { timeZone: timezone }) : 'Choose a verified slot'}</span>
          <Button size="sm" disabled={booking || loadingSlots || !connected || !slots.some(slot => slot.startIso === draft.startIso) || !draft.startIso || !draft.attendeeEmail || !draft.attendeeFirstName.trim() || !draft.attendeeLastName.trim()} onClick={() => void submit()}>
            {booking ? 'Booking…' : 'Book & email confirmation'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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

function SlotButton({ slot, selected, onClick, timezone }: { timezone: string; slot: OpenSlot; selected: boolean; onClick: () => void }) {
  const date = new Date(slot.startIso)
  return (
    <button type="button" onClick={onClick} className={cn('rounded-md border px-2 py-1.5 text-left', selected ? 'border-selected-border bg-selected text-selected-foreground' : 'border-border hover:bg-accent')}>
      <span className="block text-xs font-medium text-foreground">{date.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' })} · {date.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })}</span>
      <span className="text-micro text-muted-foreground">
        {slot.afterHours ? 'after hours · ' : ''}{slot.meetingOrdinal >= 2 ? `meeting #${slot.meetingOrdinal}` : 'first client meeting'}
      </span>
    </button>
  )
}
