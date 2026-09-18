'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { AddressAutocomplete, type ParsedAddress } from '@/components/address-autocomplete'

export interface AddressParts {
  address_line1: string
  city: string
  state: string
  zip: string
}

const LABEL = 'text-micro text-muted-foreground'

/** "42 Larchmont Rd" then "Newton, MA 02459" — the way an envelope reads. */
export function addressLines(parts: AddressParts): string[] {
  const cityState = [parts.city.trim(), parts.state.trim()].filter(Boolean).join(', ')
  return [
    parts.address_line1.trim(),
    [cityState, parts.zip.trim()].filter(Boolean).join(' '),
  ].filter(Boolean)
}

/**
 * The client's mailing address. Reads as wrapped text so a long street line
 * stays whole — the rail is too narrow to show one on a single line — and
 * opens a street/city/state/ZIP editor on the pencil. Autocomplete fills all
 * four at once; typing into them by hand saves just as well, which the
 * always-on single input this replaced never did.
 */
export function InlineAddress({
  label = 'Address',
  value,
  hideWhenEmpty = false,
  onSave,
}: {
  label?: string
  value: AddressParts
  hideWhenEmpty?: boolean
  onSave: (next: AddressParts) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<AddressParts>(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streetRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  // The pencil unmounts under the pointer, so focus falls to the body unless
  // the editor claims it back.
  useEffect(() => {
    if (editing) streetRef.current?.focus()
  }, [editing])

  const lines = addressLines(value)

  async function commit() {
    if (saving) return
    const next: AddressParts = {
      address_line1: draft.address_line1.trim(),
      city: draft.city.trim(),
      state: draft.state.trim(),
      zip: draft.zip.trim(),
    }
    if (addressLines(next).join('\n') === lines.join('\n')) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    if (saving) return
    setDraft(value)
    setError(null)
    setEditing(false)
  }

  if (!editing && lines.length === 0 && hideWhenEmpty) return null

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => {
          setError(null)
          setEditing(true)
        }}
        className="group flex w-full items-start justify-between gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
      >
        <span className={`${LABEL} pt-0.5`}>{label}</span>
        <span className="flex min-w-0 items-start gap-1.5 text-xs">
          <span className="min-w-0 break-words text-right">
            {lines.length === 0
              ? '—'
              : lines.map(line => <span key={line} className="block">{line}</span>)}
          </span>
          <Pencil
            className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
            aria-hidden
          />
        </span>
      </button>
    )
  }

  const field = 'h-7 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus:border-ring'

  // Enter and Escape are the rail's contract for an editable row, and the
  // whole block listens so all four fields answer to them. The street field is
  // the autocomplete's: when its suggestion list is open it swallows Escape to
  // shut the list, so the first press closes the list and the second leaves the
  // editor. Buttons are excluded — Enter on Save already clicks it.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLInputElement)) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  return (
    <div
      className="space-y-1.5 rounded-md bg-muted px-1.5 py-1.5"
      onKeyDown={handleKeyDown}
    >
      <span className={LABEL}>{label}</span>
      <AddressAutocomplete
        value={draft.address_line1}
        inputRef={streetRef}
        disabled={saving}
        placeholder="Street address"
        aria-label={`${label} street`}
        onChange={next => setDraft(current => ({ ...current, address_line1: next }))}
        onPlaceSelected={(parsed: ParsedAddress) =>
          setDraft({
            address_line1: parsed.address_line1,
            city: parsed.city,
            state: parsed.state,
            zip: parsed.zip,
          })
        }
        inputClassName={field}
      />
      <div className="flex gap-1">
        <input
          aria-label={`${label} city`}
          placeholder="City"
          disabled={saving}
          value={draft.city}
          onChange={event => setDraft(current => ({ ...current, city: event.target.value }))}
          className={`${field} flex-1`}
        />
        <input
          aria-label={`${label} state`}
          placeholder="ST"
          maxLength={2}
          disabled={saving}
          value={draft.state}
          onChange={event =>
            setDraft(current => ({ ...current, state: event.target.value.toUpperCase() }))
          }
          className={`${field} w-10 shrink-0 uppercase`}
        />
        <input
          aria-label={`${label} ZIP`}
          placeholder="ZIP"
          inputMode="numeric"
          disabled={saving}
          value={draft.zip}
          onChange={event => setDraft(current => ({ ...current, zip: event.target.value }))}
          className={`${field} w-16 shrink-0 tabular-nums`}
        />
      </div>
      {error && <p role="alert" className="text-micro text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={cancel}
          className="text-micro text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void commit()}
          className="text-micro font-semibold text-primary hover:underline"
        >
          {saving ? 'Saving…' : error ? 'Retry' : 'Save'}
        </button>
      </div>
    </div>
  )
}
