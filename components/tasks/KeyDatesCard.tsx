'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isSettledDateEntry } from '@/lib/firmDate'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** The dates the plan's schedule hangs off. */
export interface SlaAnchors {
  discoveryCallAt: string | null
  pmpsAt: string | null
  recommendationsSentAt: string | null
  engagementSignedAt: string | null
  fitDecision: string | null
}

const ANCHOR_FIELDS: { key: keyof SlaAnchors; label: string; hint: string }[] = [
  { key: 'discoveryCallAt', label: 'Discovery call', hint: 'Starts the soft clock' },
  { key: 'pmpsAt', label: 'Planning session', hint: 'Dates the organizer and prep tasks' },
  { key: 'recommendationsSentAt', label: 'Recommendations sent', hint: 'Drives the follow-up nudges' },
  { key: 'engagementSignedAt', label: 'Engagement signed', hint: 'Day 0 — starts the 28-day clock' },
]

function parseDateEntry(value: string): string | null {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  const iso = us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : value.trim()
  if (!isSettledDateEntry(iso)) return null
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}

export function KeyDateEditor({ label, hint, value, saving, onSave }: {
  label: string; hint: string; value: string | null; saving: boolean; onSave: (value: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value ?? '')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  function save() {
    if (saving || !editing) return
    const parsed = parseDateEntry(draft)
    if (draft.trim() && !parsed) { setError('Enter a valid date as MM/DD/YYYY or YYYY-MM-DD.'); return }
    setError(null)
    onSave(parsed)
    setEditing(false)
  }
  return <div className="space-y-1">
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <Input ref={input} type="text" placeholder="MM/DD/YYYY" autoComplete="off" className="h-9" disabled={saving} defaultValue={value ?? ''}
        onChange={event => { setDraft(event.target.value); setEditing(true); setError(null) }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save() } }} />
    </label>
    <span className="block text-micro text-muted-foreground">{hint}</span>
    {editing && <div className="flex items-center gap-2">
      <Button type="button" size="sm" disabled={saving} onClick={save}>Save date</Button>
      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => {
        if (input.current) input.current.value = value ?? ''
        setDraft(value ?? ''); setEditing(false); setError(null)
      }}>Cancel</Button>
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}

export function KeyDatesCard({
  anchors,
  saving,
  onSave,
  showFitDecision = true,
  embedded = false,
}: {
  showFitDecision?: boolean
  embedded?: boolean
  anchors: SlaAnchors
  saving: boolean
  onSave: (patch: Partial<SlaAnchors>) => void
}) {
  return (
    <Card className={embedded ? 'gap-3 rounded-none border-0 bg-transparent py-0 shadow-none' : undefined}>
      <CardHeader className={embedded ? 'px-0' : 'border-b [.border-b]:pb-3'}>
        <CardTitle className="text-sm">Key dates</CardTitle>
        <p className="text-xs text-muted-foreground">
          Enter MM/DD/YYYY or YYYY-MM-DD, including past dates. Save when ready to update linked tasks.
        </p>
      </CardHeader>
      <CardContent className={embedded ? 'grid gap-3 px-0 sm:grid-cols-2' : 'grid gap-3 pt-4 sm:grid-cols-2'}>
        {ANCHOR_FIELDS.map(field => (
          <KeyDateEditor key={`${field.key}-${anchors[field.key] ?? ''}-${saving}`} label={field.label} hint={field.hint}
            value={anchors[field.key]} saving={saving} onSave={value => onSave({ [field.key]: value })} />
        ))}
        {showFitDecision && <div className="space-y-1">
          <span className="text-xs font-medium text-foreground">Fit decision</span>
          <Select
            value={anchors.fitDecision ?? 'undecided'}
            disabled={saving}
            onValueChange={value =>
              onSave({ fitDecision: value === 'undecided' ? null : value })
            }
          >
            <SelectTrigger className="h-9" aria-label="Fit decision"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="undecided">Not decided</SelectItem>
              <SelectItem value="fit">Proceed — good fit</SelectItem>
              <SelectItem value="not_a_fit">Not a fit</SelectItem>
            </SelectContent>
          </Select>
          <span className="block text-micro text-muted-foreground">
            Gates the organizer and planning-session tasks
          </span>
        </div>}
      </CardContent>
    </Card>
  )
}
