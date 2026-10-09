'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { SchedulingLinkTarget } from '@/components/scheduling/SendSchedulingLinkDialog'

interface TypeOption {
  key: string
  label: string
  configured: boolean
  embedUrl: string | null
}

/**
 * Opens the firm's own client booking page (/book/<type>) for a lead or
 * matter, filled in with the client's details, so staff can book exactly as
 * the client would see it.
 */
export function BookingPageDialog({
  target,
  open,
  onOpenChange,
  onBooked,
}: {
  target: SchedulingLinkTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  onBooked?: () => void
}) {
  const token = useAccessToken()
  const [types, setTypes] = useState<TypeOption[] | null>(null)
  const [typeKey, setTypeKey] = useState('')
  const [booked, setBooked] = useState(false)

  const query = target.kind === 'lead' ? `leadId=${target.id}` : `matterId=${target.id}`

  useEffect(() => {
    if (!open || !token) return
    setBooked(false)
    setTypes(null)
    fetch(`/api/admin/scheduling-links/send?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load')
        return json as { types: TypeOption[] }
      })
      .then(json => {
        const list = Array.isArray(json.types) ? json.types : []
        setTypes(list)
        setTypeKey(list.find(t => t.configured)?.key ?? '')
      })
      .catch(e => {
        setTypes([])
        toast.error(e instanceof Error ? e.message : 'Failed to load booking pages')
      })
  }, [open, token, query])

  // The booking page posts this message when the client-side booking completes.
  useEffect(() => {
    if (!open) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if ((event.data as { type?: string } | null)?.type !== 'cornerstone:booking-confirmed') return
      setBooked(true)
      onBooked?.()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, onBooked])

  const selected = types?.find(t => t.key === typeKey)
  const pageUrl = selected?.embedUrl ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Book via booking page</DialogTitle>
          <DialogDescription>
            The firm&apos;s client booking page, filled in for this client. The client gets the usual confirmation email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Appointment type</Label>
            <div className="flex flex-wrap gap-2">
              {(types ?? []).map(type => (
                <Button
                  key={type.key}
                  type="button"
                  size="sm"
                  variant={typeKey === type.key ? 'default' : 'outline'}
                  disabled={!type.configured}
                  title={type.configured ? undefined : 'Portal-only type: available for hired clients'}
                  onClick={() => { setTypeKey(type.key); setBooked(false) }}
                >
                  {type.label}
                </Button>
              ))}
            </div>
          </div>
          {booked ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-sm">
              Booked. The appointment is on the calendar and linked to this client by email.
            </div>
          ) : !types ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pageUrl ? (
            <iframe
              key={pageUrl}
              src={pageUrl}
              title={`${selected?.label ?? 'Appointment'} booking page`}
              className="h-[640px] w-full rounded-md border"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No active appointment types. Add one in Settings → Scheduling.
            </p>
          )}
          <div className="flex items-center justify-between">
            {pageUrl && !booked ? (
              <a
                href={pageUrl}
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
