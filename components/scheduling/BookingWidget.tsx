'use client'

import { useState } from 'react'
import SlotPicker from '@/components/scheduling/SlotPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface BookingWidgetType {
  key: string
  slug: string
  label: string
  description: string
  durationMinutes: number
  locationType: 'phone' | 'teams' | 'in_person'
}

export interface BookingWidgetProps {
  type: BookingWidgetType
  /** Prefill for signed-in portal clients. */
  defaultName?: string
  defaultEmail?: string
  defaultPhone?: string
  /** Locks the email field (portal: the session email is authoritative). */
  emailLocked?: boolean
}

const LOCATION_HINT: Record<BookingWidgetType['locationType'], string> = {
  phone: 'Phone call — we will call the number you provide.',
  teams: 'Video call — a Microsoft Teams link will be in your calendar invite.',
  in_person: 'In person at our office.',
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
  defaultName = '',
  defaultEmail = '',
  defaultPhone = '',
  emailLocked = false,
}: BookingWidgetProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [phone, setPhone] = useState(defaultPhone)
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
          name,
          email,
          phone: phone || undefined,
          notes: notes || undefined,
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
          {type.durationMinutes} minutes · {LOCATION_HINT[type.locationType]}
        </p>
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
              <Label htmlFor="booking-name">Name</Label>
              <Input
                id="booking-name"
                className="mt-1"
                required
                value={name}
                onChange={e => setName(e.target.value)}
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
                Phone{type.locationType === 'phone' ? '' : ' (optional)'}
              </Label>
              <Input
                id="booking-phone"
                className="mt-1"
                type="tel"
                required={type.locationType === 'phone'}
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>
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
