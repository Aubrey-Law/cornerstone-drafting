'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ExternalCalendarRef } from './types'

interface Props {
  discoveryLoading?: boolean
  connected?: boolean
  error?: string | null
  truncated?: boolean
  skipped?: string[]
  discoveryUnavailable?: boolean
  calendars: ExternalCalendarRef[]
  hiddenIds: string[]
  authHeaders: () => HeadersInit | undefined
  /** Called after a successful save, so the caller can refetch the range. */
  onChange: (hiddenIds: string[]) => void
}

/**
 * Which calendars show on the grid.
 *
 * A view control, so it lives where the attorney is looking. The matching
 * booking policy is in Settings → Scheduling on purpose: it changes what
 * clients can book and should not be one click from the grid.
 */
export function CalendarVisibilityPopover({ calendars, hiddenIds, authHeaders, onChange, connected = true, error, truncated = false, skipped = [], discoveryUnavailable = false, discoveryLoading = false }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (next: string[]) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { hiddenCalendarIds: next } }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onChange(next)
    } catch {
      toast.error('Could not save which calendars to show')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string, show: boolean) => {
    void save(show ? hiddenIds.filter(hidden => hidden !== id) : [...new Set([...hiddenIds, id])])
  }

  const shown = calendars.filter(c => c.isDefault || !hiddenIds.includes(c.id)).length

  const warning = !connected || error || truncated || skipped.length > 0 || discoveryUnavailable

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
          title="Choose which calendars appear here"
          data-testid="calendar-visibility-trigger"
        >
          Calendars <span className="text-muted-foreground">{discoveryLoading ? 'Loading…' : discoveryUnavailable ? 'Unavailable' : `${shown + 1} of ${calendars.length + 1}`}</span>
          {warning && <span className="h-2 w-2 rounded-full bg-amber" role="img" aria-label="Calendar warning" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <p className="text-xs font-medium text-foreground">Show on this calendar</p>
        {(!connected || error || truncated || discoveryUnavailable) && (
          <div className="rounded border border-amber-strong-border bg-amber-bg p-2 text-xs text-foreground" role="status">
            {!connected && <p>Google Calendar is not connected.</p>}
            {error && <p>{error}</p>}
            {truncated && <p>Partial calendar results. Narrow the date range to see more events.</p>}
            {discoveryUnavailable && <p>Calendar list unavailable.</p>}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked disabled />Cornerstone appointments <span className="ml-auto text-xs text-muted-foreground">always</span></label>
        {calendars.map(calendar => (
          <div key={calendar.id}><label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={calendar.isDefault || saving}
              checked={calendar.isDefault || !hiddenIds.includes(calendar.id)}
              onChange={e => toggle(calendar.id, e.target.checked)}
            />
            <span className="truncate">{calendar.name}</span>
            {calendar.isDefault && (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">always</span>
            )}
          </label>
          {(skipped.includes(calendar.id) || skipped.includes(calendar.name)) && <p className="mt-1 rounded border border-amber-strong-border bg-amber-bg p-2 text-xs text-foreground">Google could not return this calendar.</p>}
          </div>
        ))}
        {skipped.filter(id => !calendars.some(calendar => (calendar.id === id || calendar.name === id))).map(id => <p key={id} className="rounded border border-amber-strong-border bg-amber-bg p-2 text-xs text-foreground">Calendar unavailable: {id}</p>)}
        <p className="pt-1 text-xs text-muted-foreground">
          Hiding a calendar also stops Cornerstone reading it. To stop a calendar
          blocking client bookings, use <Link className="underline" href="/admin/settings?tab=scheduling">Settings → Scheduling</Link>.
        </p>
      </PopoverContent>
    </Popover>
  )
}
