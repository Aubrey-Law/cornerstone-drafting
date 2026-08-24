'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { isSettledDateEntry } from '@/lib/firmDate'
import { cn } from '@/lib/utils'

const ROW = 'flex items-center justify-between gap-2.5 rounded-md px-1.5 py-1'
const LABEL = 'text-[11.5px] text-muted-foreground'
const VALUE = 'text-[12.5px]'

export function ReadOnlyRow({
  label,
  children,
  tabular = false,
  onClick,
  empty = false,
  hideWhenEmpty = false,
}: {
  label: string
  children: React.ReactNode
  tabular?: boolean
  /** Present when the value belongs to another surface (e.g. the People tab). */
  onClick?: () => void
  /** The row has nothing to show — the caller knows, the children do not. */
  empty?: boolean
  hideWhenEmpty?: boolean
}) {
  if (empty && hideWhenEmpty) return null
  const value = (
    <span className={cn(VALUE, 'flex items-center gap-1.5', tabular && 'tabular-nums')}>
      {children}
    </span>
  )
  if (!onClick) {
    return (
      <div className={ROW}>
        <span className={LABEL}>{label}</span>
        {value}
      </div>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cn(ROW, 'w-full text-left hover:bg-muted')}>
      <span className={LABEL}>{label}</span>
      {value}
    </button>
  )
}

/**
 * A label/value row that becomes an input on click. Enter saves, Escape
 * cancels, blur saves — the same contract across every text field here.
 */
export function InlineText({
  label,
  value,
  placeholder = '—',
  tabular = false,
  hideWhenEmpty = false,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  tabular?: boolean
  /** Skip the row entirely while it has no value (the rail's "hide empty" mode). */
  hideWhenEmpty?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // Escape fires before blur; without this the blur handler would still save.
  const settled = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    if (settled.current) return
    settled.current = true
    setEditing(false)
    if (draft !== value) void onSave(draft)
  }

  function cancel() {
    settled.current = true
    setDraft(value)
    setEditing(false)
  }

  if (hideWhenEmpty && !value && !editing) return null

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          settled.current = false
          setEditing(true)
        }}
        className={cn(ROW, 'group w-full text-left hover:bg-muted')}
      >
        <span className={LABEL}>{label}</span>
        <span className={cn(VALUE, 'flex min-w-0 items-center gap-1.5', tabular && 'tabular-nums')}>
          <span className="truncate">{value || placeholder}</span>
          <Pencil
            className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
            aria-hidden
          />
        </span>
      </button>
    )
  }

  return (
    <div className={ROW}>
      <span className={LABEL}>{label}</span>
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
        className={cn(
          'h-7 w-44 rounded-md border border-input bg-background px-1.5 text-right text-[12.5px] outline-none focus:border-ring',
          tabular && 'tabular-nums',
        )}
      />
    </div>
  )
}

/** Reads as text until hovered, then shows its chrome. Saves on change. */
export function InlineSelect({
  label,
  value,
  options,
  accent = false,
  disabled = false,
  onSave,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  accent?: boolean
  disabled?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  return (
    <div className={cn(ROW, 'hover:bg-muted')}>
      <span className={LABEL}>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={event => void onSave(event.target.value)}
        className={cn(
          'h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] hover:border-input hover:bg-background focus:border-ring focus:outline-none',
          accent && 'font-semibold text-primary',
        )}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function InlineDate({
  label,
  value,
  emphasized = false,
  derived = false,
  hideWhenEmpty = false,
  onSave,
}: {
  label: string
  /** `YYYY-MM-DD`, or empty when unset. */
  value: string
  emphasized?: boolean
  /** The shown value came from another date, not from a stored column. */
  derived?: boolean
  /** Skip the row entirely while it has no value (the rail's "hide empty" mode). */
  hideWhenEmpty?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  if (hideWhenEmpty && !value) return null
  return (
    <div className={cn(ROW, 'hover:bg-muted')}>
      <span className={cn(LABEL, emphasized && 'font-semibold text-foreground')}>
        {label}
        {derived && (
          <span className="ml-1 text-[9.5px] font-semibold uppercase tracking-[.05em] text-primary">
            auto
          </span>
        )}
      </span>
      <input
        type="date"
        aria-label={label}
        // Keyed on the value so a derived date re-renders when its anchor moves.
        key={value}
        defaultValue={value}
        // Saving on change — rather than waiting for the field to lose focus —
        // records a picked date immediately. It has to wait for a settled one
        // though: the browser reports a complete date while the year is still
        // being typed (0002, 0020, 0202 on the way to 2026), and reports "" for
        // every segment before that. Saving either would overwrite a good date
        // with a half-typed one. Blur is what commits a genuine clear, and it
        // stands down when the control says the entry is unfinished.
        onChange={event => {
          const next = event.target.value
          if (isSettledDateEntry(next) && next !== value) void onSave(next)
        }}
        onBlur={event => {
          if (event.target.validity?.badInput) return
          const next = event.target.value
          if (next !== value && (next === '' || isSettledDateEntry(next))) void onSave(next)
        }}
        className={cn(
          'h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] tabular-nums hover:border-input hover:bg-background focus:border-ring focus:outline-none',
          emphasized && 'border-input bg-background font-semibold text-primary',
        )}
      />
    </div>
  )
}
