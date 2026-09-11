'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
  MAX_ADDITIONAL_CHANNELS,
  formatContactChannel,
  isEmailAddress,
  type ContactChannel,
  type ContactChannelKind,
} from '@/lib/contacts/additionalChannels'
import { formatPhoneInput } from '@/lib/phone'
import { cn } from '@/lib/utils'

/**
 * The extra addresses a person can be reached at, under their primary one.
 *
 * Each row is label + value; saving hands the whole list back so the caller
 * writes one column rather than diffing entries. Empty and read-only until
 * something is added, so a rail with nothing extra stays as short as it was.
 */
export function ChannelListField({
  label,
  kind,
  channels,
  hideWhenEmpty = false,
  onSave,
}: {
  label: string
  kind: ContactChannelKind
  channels: ContactChannel[]
  hideWhenEmpty?: boolean
  onSave: (next: ContactChannel[]) => void | Promise<void>
}) {
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ContactChannel[]>(channels)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setDraft(channels)
  }, [channels, editing])

  if (!editing && channels.length === 0 && hideWhenEmpty) return null

  const placeholder = kind === 'email' ? 'name@example.com' : '(555) 555-5555'

  function update(index: number, patch: Partial<ContactChannel>) {
    setDraft(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function commit() {
    if (savingRef.current) return
    const cleaned = draft
      .map(row => ({ label: row.label.trim(), value: row.value.trim() }))
      .filter(row => row.value)
    const invalid = cleaned.find(row =>
      kind === 'email'
        ? !isEmailAddress(row.value)
        : row.value.replace(/\D/g, '').length < 10)
    if (invalid) {
      setError(`"${invalid.value}" is not a valid ${kind === 'email' ? 'email address' : 'phone number'}`)
      return
    }
    setError(null)
    savingRef.current = true
    setSaving(true)
    try {
      await onSave(cleaned)
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Try again.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2.5 rounded-md px-1.5 py-1">
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
        <button
          type="button"
          aria-label={`${channels.length === 0 ? 'Add' : 'Edit'} ${label}`}
          onClick={() => {
            // Opening an empty list straight onto a blank row saves a click and
            // makes it obvious the field takes a label and a value.
            setDraft(channels.length > 0 ? channels : [{ label: '', value: '' }])
            setEditing(true)
          }}
          className="min-w-0 text-right text-[12.5px] hover:text-primary"
        >
          {channels.length === 0 ? (
            <span className="text-muted-foreground">+ Add</span>
          ) : (
            channels.map(channel => (
              <span key={`${channel.label}-${channel.value}`} className="block truncate">
                {formatContactChannel(channel, kind)}
              </span>
            ))
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1 rounded-md bg-muted/40 px-1.5 py-1.5">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      {draft.map((row, index) => (
        <div key={index} className="flex items-center gap-1">
          <input
            disabled={saving}
            aria-label={`${label} label ${index + 1}`}
            value={row.label}
            placeholder={kind === 'email' ? 'Work' : 'Mobile'}
            onChange={event => update(index, { label: event.target.value })}
            className="h-7 w-16 shrink-0 rounded-md border border-input bg-background px-1.5 text-[11.5px] outline-none focus:border-ring"
          />
          <input
            disabled={saving}
            aria-label={`${label} ${index + 1}`}
            value={row.value}
            placeholder={placeholder}
            inputMode={kind === 'email' ? 'email' : 'tel'}
            onChange={event => update(index, {
              value: kind === 'phone' ? formatPhoneInput(event.target.value) : event.target.value,
            })}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commit()
              }
              if (event.key === 'Escape' && !saving) {
                event.preventDefault()
                setDraft(channels)
                setError(null)
                setEditing(false)
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-[12.5px] outline-none focus:border-ring"
          />
          <button
            type="button"
            disabled={saving}
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() => setDraft(current => current.filter((_, i) => i !== index))}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-[11px] text-red-strong">{error}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={saving || draft.length >= MAX_ADDITIONAL_CHANNELS}
          onClick={() => setDraft(current => [...current, { label: '', value: '' }])}
          className={cn(
            'inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline',
            draft.length >= MAX_ADDITIONAL_CHANNELS && 'pointer-events-none text-muted-foreground',
          )}
        >
          <Plus className="size-3" aria-hidden />
          Add another
        </button>
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft(channels)
              setError(null)
              setEditing(false)
            }}
            className="text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit()}
            className="text-[11.5px] font-semibold text-primary hover:underline"
          >
            {saving ? 'Saving…' : error ? 'Retry' : 'Save'}
          </button>
        </span>
      </div>
    </div>
  )
}
