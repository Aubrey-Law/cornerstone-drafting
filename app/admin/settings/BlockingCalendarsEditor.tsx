'use client'

import type { ExternalCalendarRef } from '@/app/admin/calendar/types'
import { staleBlockingIds } from '@/lib/appointments/calendarSelection'

interface Props {
  calendars: ExternalCalendarRef[]
  connected: boolean
  blockingIds: string[]
  disabled: boolean
  onChange: (blockingIds: string[]) => void
}

/**
 * Which calendars protect the firm's time from client booking.
 *
 * Separate from the calendar page's visibility popover because this changes
 * what clients can book. Blocking is off by default for a reason worth
 * repeating in the UI: Google treats an all-day event as busy for the whole
 * day, so a holiday or birthday calendar that blocked would wipe out those
 * days entirely.
 */
export function BlockingCalendarsEditor({
  calendars,
  connected,
  blockingIds,
  disabled,
  onChange,
}: Props) {
  const stale = staleBlockingIds(calendars, blockingIds)

  const toggle = (id: string, blocks: boolean) => {
    onChange(blocks ? [...new Set([...blockingIds, id])] : blockingIds.filter(b => b !== id))
  }

  if (!connected) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Calendars that block booking</p>
        <p className="text-sm text-muted-foreground">
          Google Calendar is not connected. Connect it from Settings → Google &amp; Teams to
          choose which calendars protect your time.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Calendars that block booking</p>
      <p className="text-sm text-muted-foreground">
        An event on one of these makes the slot unavailable to clients. Your main
        calendar always blocks. Leave holiday and birthday calendars off — Google
        counts an all-day event as busy for the whole day.
      </p>
      {calendars.map(calendar => (
        <label key={calendar.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={calendar.isDefault || disabled}
            checked={calendar.isDefault || blockingIds.includes(calendar.id)}
            onChange={e => toggle(calendar.id, e.target.checked)}
          />
          <span className="truncate">{calendar.name}</span>
          {calendar.isDefault && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">always</span>
          )}
        </label>
      ))}
      {stale.map(id => (
        <div
          key={id}
          className="flex items-center gap-2 rounded border border-amber-border bg-amber-bg px-2 py-1 text-sm"
        >
          <span className="truncate text-amber">{id}</span>
          <span className="shrink-0 text-xs text-amber">
            Google no longer serves this calendar — it will block all booking until removed
          </span>
          <button
            type="button"
            className="ml-auto shrink-0 text-xs underline"
            disabled={disabled}
            onClick={() => toggle(id, false)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}
