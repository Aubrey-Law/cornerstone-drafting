'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ExternalCalendarRef } from './types'

interface Props {
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
export function CalendarVisibilityPopover({ calendars, hiddenIds, authHeaders, onChange }: Props) {
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          title="Choose which calendars appear here"
          data-testid="calendar-visibility-trigger"
        >
          · {shown} of {calendars.length} calendars
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <p className="text-xs font-medium text-foreground">Show on this calendar</p>
        {calendars.map(calendar => (
          <label key={calendar.id} className="flex items-center gap-2 text-sm">
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
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          Hiding a calendar also stops Cornerstone reading it. To stop a calendar
          blocking client bookings, use Settings → Scheduling.
        </p>
      </PopoverContent>
    </Popover>
  )
}
