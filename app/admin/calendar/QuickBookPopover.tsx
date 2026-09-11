'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

interface Draft {
  typeId: string
  locationType: LocationType
  attendeeName: string
  attendeeEmail: string
  attendeePhone: string
  secondAttendeeName: string
  secondAttendeeEmail: string
  startIso: string
}

function initialDraft(types: BookableType[], prefillIso?: string | null): Draft {
  return {
    typeId: types[0]?.id ?? '',
    locationType: allowedFormats(types[0])[0],
    attendeeName: '',
    attendeeEmail: '',
    attendeePhone: '',
    secondAttendeeName: '',
    secondAttendeeEmail: '',
    startIso: prefillIso ?? '',
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  types: BookableType[]
  prefillIso?: string | null
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
  const selectedType = types.find(type => type.id === draft.typeId)

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
        setSlots(body.slots ?? [])
        setConnected(Boolean(body.connected))
      })
      .finally(() => setLoadingSlots(false))
    return () => controller.abort()
  }, [open, draft.typeId, draft.locationType, range, authHeaders, prefillIso])

  async function submit() {
    if (!draft.attendeeName.trim() || !draft.attendeeEmail.trim() || !draft.typeId || !draft.startIso) {
      toast.error('Choose who, what, where, and when')
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
          startIso: draft.startIso,
          attendeeName: draft.attendeeName.trim(),
          attendeeEmail: draft.attendeeEmail.trim(),
          attendeePhone: draft.attendeePhone.trim() || undefined,
          secondAttendeeName: draft.secondAttendeeName.trim() || undefined,
          secondAttendeeEmail: draft.secondAttendeeEmail.trim() || undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? 'Booking failed')
        return
      }
      toast.success('Appointment booked — confirmation email sent')
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
          <kbd className="ml-2 rounded border border-primary-foreground/30 px-1 text-[10px]">⌘⇧K</kbd>
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
                    className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted"
                    onClick={() => {
                      setDraft(current => ({
                        ...current,
                        attendeeName: person.name ?? '',
                        attendeeEmail: person.email ?? '',
                        attendeePhone: person.phone ?? '',
                        secondAttendeeName: person.secondName ?? '',
                        secondAttendeeEmail: person.secondEmail ?? '',
                      }))
                      setQuery(person.name)
                      setPeople([])
                    }}
                  >
                    <span><span className="block text-xs font-medium text-foreground">{person.name}</span><span className="text-[11px] text-muted-foreground">{person.email}</span></span>
                    <span className="text-[10px] uppercase text-muted-foreground">{person.kind}</span>
                  </button>
                ))}
              </div>
            )}
            {draft.attendeeEmail && <p className="mt-1 text-[11px] text-green-700"><Check className="mr-1 inline h-3 w-3" />{draft.attendeeName} · {draft.attendeeEmail}</p>}
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
                    locationType: allowedFormats(type).includes(current.locationType)
                      ? current.locationType
                      : allowedFormats(type)[0],
                    startIso: '',
                  }))}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', draft.typeId === type.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted')}
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
                  className={cn('rounded-full border px-2.5 py-1 text-xs', draft.locationType === format ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted')}
                >
                  {LOCATION_LABEL[format]}
                </button>
              ))}
            </div>
          </Step>

          <Step number="4" title="When">
            {!connected ? (
              <p className="rounded-md border border-amber-strong-border bg-amber-bg p-2 text-xs text-foreground">
                Google Calendar is disconnected, so verified openings are unavailable.
              </p>
            ) : loadingSlots ? (
              <p className="text-xs text-muted-foreground">Checking the calendar and appointment buffers…</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {slots.slice(0, 14).map(slot => (
                  <SlotButton key={slot.startIso} slot={slot} selected={draft.startIso === slot.startIso} onClick={() => setDraft(current => ({ ...current, startIso: slot.startIso }))} />
                ))}
              </div>
            )}
          </Step>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[11px] text-muted-foreground">{draft.startIso ? new Date(draft.startIso).toLocaleString() : 'Choose a verified slot'}</span>
          <Button size="sm" disabled={booking || !draft.startIso || !draft.attendeeEmail} onClick={() => void submit()}>
            {booking ? 'Booking…' : 'Book & email confirmation'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-1.5 text-xs font-semibold text-foreground"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-muted text-[10px]">{number}</span>{title}</h3>{children}</section>
}

function SlotButton({ slot, selected, onClick }: { slot: OpenSlot; selected: boolean; onClick: () => void }) {
  const date = new Date(slot.startIso)
  return (
    <button type="button" onClick={onClick} className={cn('rounded-md border px-2 py-1.5 text-left', selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>
      <span className="block text-xs font-medium text-foreground">{date.toLocaleDateString('en-US', { weekday: 'short' })} · {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
      <span className="text-[10px] text-muted-foreground">
        {slot.afterHours ? 'after hours · ' : ''}{slot.meetingOrdinal >= 2 ? `meeting #${slot.meetingOrdinal}` : 'first client meeting'}
      </span>
    </button>
  )
}
