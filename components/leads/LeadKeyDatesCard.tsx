'use client'

import { Input } from '@/components/ui/input'
import { isSettledDateEntry } from '@/lib/firmDate'

/**
 * The pre-engagement clock's anchors, as `YYYY-MM-DD` or null. They live on the
 * opportunity's matter row, not on the intake, so they save through the
 * sla-anchors route rather than the field rail — setting one also re-dates every
 * task waiting on it.
 */
export type LeadKeyDates = {
  discoveryCallAt: string | null
  pmpsAt: string | null
}

export const LEAD_KEY_DATE_FIELDS: {
  key: keyof LeadKeyDates
  label: string
  hint: string
}[] = [
  { key: 'discoveryCallAt', label: 'Discovery date', hint: 'Starts the pre-engagement clock' },
  { key: 'pmpsAt', label: 'PMPS date', hint: 'Dates the organizer and prep tasks' },
]

export function LeadKeyDatesCard({
  keyDates,
  onSaveKeyDate,
  saving = false,
}: {
  keyDates: LeadKeyDates
  onSaveKeyDate: (field: keyof LeadKeyDates, value: string | null) => Promise<void>
  saving?: boolean
}) {
  return (
    <section aria-label="Key dates" className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Key dates</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Setting a date schedules the SLA tasks waiting on it.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {LEAD_KEY_DATE_FIELDS.map(field => (
          <label className="block space-y-1" key={field.key}>
            <span className="block text-micro font-medium uppercase tracking-wide text-muted-foreground">
              {field.label}
            </span>
            <Input
              aria-label={field.label}
              className="h-8"
              disabled={saving}
              type="date"
              // Uncontrolled and keyed on the saved value: a date input
              // reads back as "" until every segment is filled, so echoing
              // that back mid-entry would wipe what was typed. Only a
              // complete date — or an explicit clear on blur — saves.
              defaultValue={keyDates[field.key] ?? ''}
              key={`${field.key}-${keyDates[field.key] ?? ''}`}
              onChange={event => {
                // Not merely non-empty: the browser reports a complete date
                // while the year is still arriving (0002, 0020, 0202 on the
                // way to 2026). Saving the first of those is how this field
                // wrote a 1969 discovery call, and why the date had to be
                // entered one segment per attempt. Blur below still clears.
                const next = event.target.value
                if (isSettledDateEntry(next) && next !== keyDates[field.key]) {
                  void onSaveKeyDate(field.key, next)
                }
              }}
              onBlur={event => {
                const next = event.target.value
                if (!next && keyDates[field.key]) void onSaveKeyDate(field.key, null)
              }}
            />
            <span className="block text-micro text-muted-foreground">{field.hint}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
