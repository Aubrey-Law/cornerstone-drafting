'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuickBookForm, type QuickBookAttendee } from '@/app/admin/calendar/QuickBookPopover'
import type { BookableType } from '@/app/admin/calendar/types'
import type { SchedulingLinkTarget } from '@/components/scheduling/SendSchedulingLinkDialog'
import { FIRM_TIMEZONE } from '@/lib/firmDate'

/**
 * Books an appointment in the firm's own scheduler from a lead or matter page:
 * the same verified openings and confirmation email as Quick book on the
 * calendar, with the client filled in and the booking linked to the record.
 */
export function ScheduleAppointmentDialog({
  target,
  attendee,
  open,
  onOpenChange,
  onBooked,
}: {
  target: SchedulingLinkTarget
  attendee: QuickBookAttendee
  open: boolean
  onOpenChange: (open: boolean) => void
  onBooked?: () => void
}) {
  const token = useAccessToken()
  const [types, setTypes] = useState<BookableType[] | null>(null)
  const [timezone, setTimezone] = useState(FIRM_TIMEZONE)
  const [loadError, setLoadError] = useState<string | null>(null)

  const authHeaders = useCallback(
    (): HeadersInit | undefined => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  useEffect(() => {
    if (!open || !token || types) return
    let cancelled = false
    setLoadError(null)
    void fetch('/api/admin/scheduling/settings', { headers: authHeaders() })
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load appointment types')
        return body as { types?: BookableType[]; settings?: { timezone?: string } }
      })
      .then(body => {
        if (cancelled) return
        setTypes((body.types ?? []).filter(type => type.active))
        if (body.settings?.timezone) setTimezone(body.settings.timezone)
      })
      .catch(error => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load appointment types')
      })
    return () => { cancelled = true }
  }, [open, token, types, authHeaders])

  const link = target.kind === 'lead' ? { leadId: target.id } : { matterId: target.id }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Schedule appointment</DialogTitle>
          <DialogDescription>
            Pick a verified opening; the client gets the confirmation email and the appointment is linked to this {target.kind}.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="p-5 text-sm text-destructive">{loadError}</p>
        ) : !types ? (
          <p className="p-5 text-sm text-muted-foreground">Loading appointment types…</p>
        ) : types.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            No active appointment types. Add one in Settings → Scheduling.
          </p>
        ) : (
          <QuickBookForm
            active={open}
            types={types}
            timezone={timezone}
            authHeaders={authHeaders}
            attendee={attendee}
            link={link}
            showSearch={false}
            bodyClassName="max-h-[75vh]"
            onBooked={() => {
              onOpenChange(false)
              onBooked?.()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
