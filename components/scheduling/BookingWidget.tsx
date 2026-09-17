'use client'

import { useState } from 'react'
import SlotPicker from '@/components/scheduling/SlotPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatPhoneInput } from '@/lib/phone'

type LocationType = 'phone' | 'teams' | 'in_person'

export interface BookingWidgetType {
  key: string
  slug: string
  label: string
  description: string
  durationMinutes: number
  locationType: LocationType
  /** Formats the client may choose from, in display order. */
  locationTypes?: LocationType[]
}

export interface BookingWidgetProps {
  type: BookingWidgetType
  /** Prefill for signed-in portal clients. */
  defaultFirstName?: string
  defaultLastName?: string
  defaultEmail?: string
  defaultPhone?: string
  /** Locks the email field (portal: the session email is authoritative). */
  emailLocked?: boolean
}

const LOCATION_HINT: Record<LocationType, string> = {
  phone: 'Phone call — we will call the number you provide.',
  teams: 'Video call — a Microsoft Teams link will be in your calendar invite.',
  in_person: 'In person at our office.',
}

const LOCATION_LABEL: Record<LocationType, string> = {
  phone: 'Phone call',
  teams: 'Virtual meeting',
  in_person: 'In person',
}

function fmtSelected(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function BookingWidget({
  type,
  defaultFirstName = '',
  defaultLastName = '',
  defaultEmail = '',
  defaultPhone = '',
  emailLocked = false,
}: BookingWidgetProps) {
  const locationOptions: LocationType[] =
    type.locationTypes && type.locationTypes.length > 0 ? type.locationTypes : [type.locationType]
  const [selected, setSelected] = useState<string | null>(null)
  const [locationType, setLocationType] = useState<LocationType>(locationOptions[0])
  const [firstName, setFirstName] = useState(defaultFirstName)
  const [lastName, setLastName] = useState(defaultLastName)
  const [email, setEmail] = useState(defaultEmail)
  const [phone, setPhone] = useState(() => formatPhoneInput(defaultPhone))
  const [includeSpouse, setIncludeSpouse] = useState(false)
  const [spouseFirstName, setSpouseFirstName] = useState('')
  const [spouseLastName, setSpouseLastName] = useState('')
  const [spouseEmail, setSpouseEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmed, setConfirmed] = useState<{ startTime: string } | null>(null)

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/scheduling/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typeKey: type.key,
          startTime: selected,
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          notes: notes || undefined,
          locationType,
          secondAttendeeFirstName: includeSpouse ? spouseFirstName || undefined : undefined,
          secondAttendeeLastName: includeSpouse ? spouseLastName || undefined : undefined,
          secondAttendeeEmail: includeSpouse ? spouseEmail || undefined : undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        startTime?: string
        error?: string
        code?: string
      }
      if (!res.ok || !json.ok) {
        if (json.code === 'slot_taken') {
          setSelected(null)
          setRefreshKey(k => k + 1)
        }
        setError(json.error ?? 'Booking failed. Please try again.')
        return
      }
      setConfirmed({ startTime: json.startTime ?? selected })
    } catch {
      setError('Booking failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmed) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">You&apos;re booked!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {type.label} — {fmtSelected(confirmed.startTime)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          A confirmation email and calendar invitation are on their way to{' '}
          <span className="font-medium text-foreground">{email}</span>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {type.durationMinutes} minutes · {LOCATION_HINT[locationType]}
        </p>
        {locationOptions.length > 1 && (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-foreground">How would you like to meet?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {locationOptions.map(option => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    locationType === option
                      ? 'border-selected-border bg-selected text-selected-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="booking-location"
                    className="sr-only"
                    checked={locationType === option}
                    onChange={() => setLocationType(option)}
                  />
                  {LOCATION_LABEL[option]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-4">
          <SlotPicker
            typeSlug={type.slug}
            selected={selected}
            onSelect={setSelected}
            refreshKey={refreshKey}
          />
        </div>
      </div>

      {selected && (
        <form
          className="rounded-lg border border-border bg-card p-5"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="text-sm font-medium text-foreground">
            Selected: {fmtSelected(selected)}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="booking-first-name">First name</Label>
              <Input
                id="booking-first-name"
                className="mt-1"
                required
                maxLength={80}
                autoComplete="given-name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="booking-last-name">Last name</Label>
              <Input
                id="booking-last-name"
                className="mt-1"
                required
                maxLength={80}
                autoComplete="family-name"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="booking-email">Email</Label>
              <Input
                id="booking-email"
                className="mt-1"
                type="email"
                required
                readOnly={emailLocked}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="booking-phone">
                Phone{locationType === 'phone' ? '' : ' (optional)'}
              </Label>
              <Input
                id="booking-phone"
                className="mt-1"
                type="tel"
                required={locationType === 'phone'}
                value={phone}
                onChange={e => setPhone(formatPhoneInput(e.target.value))}
                placeholder="(555) 555-5555"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeSpouse}
                  onChange={e => setIncludeSpouse(e.target.checked)}
                />
                Include my spouse or partner
              </label>
            </div>
            {includeSpouse && (
              <>
                <div>
                  <Label htmlFor="booking-spouse-first-name">Spouse/partner first name</Label>
                  <Input
                    id="booking-spouse-first-name"
                    className="mt-1"
                    required
                    maxLength={80}
                    value={spouseFirstName}
                    onChange={e => setSpouseFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-spouse-last-name">Spouse/partner last name</Label>
                  <Input
                    id="booking-spouse-last-name"
                    className="mt-1"
                    required
                    maxLength={80}
                    value={spouseLastName}
                    onChange={e => setSpouseLastName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-spouse-email">Spouse/partner email</Label>
                  <Input
                    id="booking-spouse-email"
                    className="mt-1"
                    type="email"
                    value={spouseEmail}
                    onChange={e => setSpouseEmail(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    They&apos;ll receive the calendar invite and reminders too.
                  </p>
                </div>
              </>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="booking-notes">Anything we should know? (optional)</Label>
              <Textarea
                id="booking-notes"
                className="mt-1"
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="mt-4" disabled={submitting}>
            {submitting ? 'Booking…' : 'Confirm booking'}
          </Button>
        </form>
      )}
    </div>
  )
}
