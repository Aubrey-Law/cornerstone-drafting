'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
        if (!cancelled) toast.error('Failed to load Calendly links')
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
      if (value && !value.startsWith('https://calendly.com/')) {
        const label = MEETING_TYPES.find(t => t.key === key)?.label ?? key
        toast.error(`${label}: links must start with https://calendly.com/`)
        return
      }
    }
    setSaving(true)
    try {
      const cleaned = Object.fromEntries(Object.entries(urls).filter(([, v]) => v.trim()))
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: { calendlyUrls: cleaned } }),
      })
      if (!res.ok) throw new Error()
      toast.success('Calendly links saved')
    } catch {
      toast.error('Failed to save Calendly links')
    } finally {
      setSaving(false)
    }
  }, [token, urls])

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Calendly booking links</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste each event type&apos;s booking page URL. These power &ldquo;Send scheduling
        link&rdquo; and &ldquo;Book for client&rdquo; on lead and matter pages.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MEETING_TYPES.map(type => (
          <div key={type.key}>
            <Label htmlFor={`calendly-${type.key}`}>{type.label}</Label>
            <Input
              id={`calendly-${type.key}`}
              className="mt-1"
              placeholder="https://calendly.com/…"
              value={urls[type.key] ?? ''}
              disabled={loading}
              onChange={e => setUrls(prev => ({ ...prev, [type.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Button type="button" size="sm" onClick={() => void save()} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save Calendly links'}
        </Button>
      </div>
    </section>
  )
}
