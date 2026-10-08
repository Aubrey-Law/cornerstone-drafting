'use client'

import { useRef, useState } from 'react'
import { KeyDateEditor } from '@/components/tasks/KeyDatesCard'

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
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [revisions, setRevisions] = useState({ discoveryCallAt: 0, pmpsAt: 0 })
  const [pendingSave, setPendingSave] = useState(false)

  async function save(field: keyof LeadKeyDates, value: string | null) {
    if (saving || pending.current) return
    pending.current = true
    setPendingSave(true)
    setError(null)
    try {
      await onSaveKeyDate(field, value)
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'Please try again.'
      setError(`Date was not saved. The previous date has been restored. ${reason}`)
    } finally {
      setRevisions(current => ({ ...current, [field]: current[field] + 1 }))
      pending.current = false
      setPendingSave(false)
    }
  }

  return (
    <section aria-label="Key dates" className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Key dates</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Enter MM/DD/YYYY or YYYY-MM-DD, including past dates. Save to update linked tasks.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {LEAD_KEY_DATE_FIELDS.map(field => (
          <KeyDateEditor
            key={`${field.key}-${keyDates[field.key] ?? ''}-${revisions[field.key]}`}
            label={field.label}
            hint={field.hint}
            value={keyDates[field.key]}
            saving={saving || pendingSave}
            onSave={value => void save(field.key, value)}
          />
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}
