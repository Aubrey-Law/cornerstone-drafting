'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { SchedulingLinkTarget } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BOOKING_PROVIDER_LABELS, bookingProviderForUrl } from '@/lib/bookings/provider'

interface TypeOption {
  key: string
  label: string
  configured: boolean
  embedUrl: string | null
}

export function BookCalendlyDialog({
  target,
  open,
  onOpenChange,
}: {
  target: SchedulingLinkTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const token = useAccessToken()
  const [types, setTypes] = useState<TypeOption[]>([])
  const [typeKey, setTypeKey] = useState('')
  const [booked, setBooked] = useState(false)

  const query = target.kind === 'lead' ? `leadId=${target.id}` : `matterId=${target.id}`

  useEffect(() => {
    if (!open || !token) return
    setBooked(false)
    fetch(`/api/admin/scheduling-links/send?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load')
        return json as { types: TypeOption[] }
      })
      .then(json => {
        const types = Array.isArray(json.types) ? json.types : []
        setTypes(types)
        setTypeKey(types.find(t => t.configured)?.key ?? '')
      })
      .catch(e => toast.error(e instanceof Error ? e.message : 'Failed to load booking links'))
  }, [open, token, query])

  // Calendly emits postMessage events when embed_domain/embed_type are set.
  useEffect(() => {
    if (!open) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://calendly.com') return
      const eventName = (event.data as { event?: string })?.event
      if (eventName === 'calendly.event_scheduled') setBooked(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open])

  const selected = types.find(t => t.key === typeKey)
  const provider = selected?.embedUrl ? bookingProviderForUrl(selected.embedUrl) : null
  const providerLabel = provider ? BOOKING_PROVIDER_LABELS[provider] : 'booking page'
  const iframeSrc = useMemo(() => {
    if (!selected?.embedUrl) return null
    const url = new URL(selected.embedUrl)
    // Calendly-only embed params; they make it emit the postMessage events
    // handled above. Other schedulers get the plain booking page.
    if (bookingProviderForUrl(url.toString()) === 'calendly') {
      url.searchParams.set('embed_domain', window.location.hostname)
      url.searchParams.set('embed_type', 'Inline')
    }
    return url.toString()
  }, [selected])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Book for client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Appointment type</Label>
            <div className="flex flex-wrap gap-2">
              {types.map(type => (
                <Button
                  key={type.key}
                  type="button"
                  size="sm"
                  variant={typeKey === type.key ? 'default' : 'outline'}
                  disabled={!type.configured}
                  title={type.configured ? undefined : 'Add the link in Settings → Scheduling'}
                  onClick={() => { setTypeKey(type.key); setBooked(false) }}
                >
                  {type.label}
                </Button>
              ))}
            </div>
          </div>
          {booked ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-sm">
              Booked — the appointment will appear on the timeline as soon as {providerLabel}{' '}
              confirms it.
            </div>
          ) : iframeSrc ? (
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              title={`${providerLabel} booking`}
              className="h-[600px] w-full rounded-md border"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No booking links configured — add them in Settings → Scheduling.
            </p>
          )}
          {iframeSrc && !booked && provider !== 'calendly' ? (
            <p className="text-xs text-muted-foreground">
              If the booking page doesn&apos;t load here, use &ldquo;Open in new tab&rdquo;.
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            {iframeSrc && !booked ? (
              <a
                href={iframeSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                Open in new tab
              </a>
            ) : <span />}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {booked ? 'Done' : 'Close'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
