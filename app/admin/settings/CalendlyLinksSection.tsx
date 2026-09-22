'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BOOKING_PROVIDER_LABELS, bookingProviderForUrl, isBookingUrl } from '@/lib/bookings/provider'

const MEETING_TYPES: Array<{ key: string; label: string }> = [
  { key: 'discovery_call', label: 'Discovery Call' },
  { key: 'pmps', label: 'Peace of Mind Planning Session' },
  { key: 'draft_review', label: 'Estate Plan Draft Review' },
  { key: 'client_call', label: 'Client Call' },
  { key: 'signing_appointment', label: 'Signing Appointment' },
]

export function CalendlyLinksSection() {
  const token = useAccessToken()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch('/api/admin/scheduling/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        setUrls({ ...(json.settings?.calendlyUrls ?? {}) })
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load booking links')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const save = useCallback(async () => {
    for (const [key, value] of Object.entries(urls)) {
      if (value.trim() && !isBookingUrl(value)) {
        const label = MEETING_TYPES.find(t => t.key === key)?.label ?? key
        toast.error(`${label}: links must be a full https:// URL`)
        return
      }
    }
    setSaving(true)
    try {
      const cleaned = Object.fromEntries(
        Object.entries(urls).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
      )
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: { calendlyUrls: cleaned } }),
      })
      if (!res.ok) throw new Error()
      toast.success('Booking links saved')
    } catch {
      toast.error('Failed to save booking links')
    } finally {
      setSaving(false)
    }
  }, [token, urls])

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Booking links</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste each event type&apos;s booking page URL from Calendly, Cal.com, Lawmatics, or
        any other scheduler (must start with https://). These power &ldquo;Send scheduling
        link&rdquo; and &ldquo;Book for client&rdquo; on lead and matter pages. Calendly and
        Cal.com bookings sync to the calendar automatically once their webhook is set up.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MEETING_TYPES.map(type => {
          const value = urls[type.key] ?? ''
          const provider = isBookingUrl(value) ? bookingProviderForUrl(value.trim()) : null
          return (
            <div key={type.key}>
              <Label htmlFor={`calendly-${type.key}`}>{type.label}</Label>
              <Input
                id={`calendly-${type.key}`}
                className="mt-1"
                placeholder="https://…"
                value={value}
                disabled={loading}
                onChange={e => setUrls(prev => ({ ...prev, [type.key]: e.target.value }))}
              />
              {provider && provider !== 'other' ? (
                <p className="mt-1 text-xs text-muted-foreground">{BOOKING_PROVIDER_LABELS[provider]}</p>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-4">
        <Button type="button" size="sm" onClick={() => void save()} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save booking links'}
        </Button>
      </div>
    </section>
  )
}
