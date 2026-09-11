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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Escape fires before blur; without this the blur handler would still save.
  const settled = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    if (settled.current) return
    settled.current = true
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      setSaved(true)
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Try again.')
      settled.current = false
    } finally { setSaving(false) }
  }

  function cancel() {
    if (saving) return
    settled.current = true
    setError(null)
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
          setSaved(false)
          setError(null)
          setEditing(true)
        }}
        className={cn(ROW, 'group w-full text-left hover:bg-muted')}
      >
        <span className={LABEL}>{label}</span>
        <span className={cn(VALUE, 'flex min-w-0 items-center gap-1.5', tabular && 'tabular-nums')}>
          <span className="truncate">{value || placeholder}</span>
          {saved && <span role="status" className="text-[11px] text-muted-foreground">Saved</span>}
          <Pencil
            className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
            aria-hidden
          />
        </span>
      </button>
    )
  }

  return (
    <div>
      <div className={ROW}>
        <span className={LABEL}>{label}</span>
        <input
          ref={inputRef}
          aria-label={label}
          value={draft}
          disabled={saving}
          aria-invalid={Boolean(error)}
          onChange={event => { setDraft(event.target.value); setError(null) }}
          onBlur={() => { if (!error) void commit() }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
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
      {saving && <p role="status" className="px-1.5 text-xs text-muted-foreground">Saving {label}…</p>}
      {error && (
        <div className="px-1.5 text-xs">
          <p role="alert" className="text-destructive">{label}: {error}</p>
          <div className="mt-1 flex gap-3">
            <button type="button" aria-label={`Retry ${label}`} className="underline" onClick={() => void commit()}>Retry</button>
            <button type="button" aria-label={`Discard ${label} changes`} className="underline" onClick={cancel}>Discard changes</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Shared feedback for controls that save without closing an editor. */
function useFieldSave(onSave: (next: string) => void | Promise<void>) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const attempted = useRef('')
  async function save(next: string) {
    if (busy.current) return
    busy.current = true
    attempted.current = next
    setStatus('saving')
    setError(null)
    try {
      await onSave(next)
      setStatus('saved')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Try again.')
      setStatus('error')
    } finally { busy.current = false }
  }
  return { status, error, save, retry: () => save(attempted.current), discard: () => { setStatus('idle'); setError(null) } }
}

function FieldSaveStatus({ label, state, onDiscard }: {
  label: string
  state: ReturnType<typeof useFieldSave>
  onDiscard: () => void
}) {
  return <>
    {(state.status === 'saving' || state.status === 'saved') && (
      <p role="status" className="px-1.5 text-xs text-muted-foreground">{state.status === 'saving' ? `Saving ${label}…` : 'Saved'}</p>
    )}
    {state.error && <div className="px-1.5 text-xs">
      <p role="alert" className="text-destructive">{label}: {state.error}</p>
      <div className="mt-1 flex gap-3">
        <button type="button" aria-label={`Retry ${label}`} className="underline" onClick={() => void state.retry()}>Retry</button>
        <button type="button" aria-label={`Discard ${label} changes`} className="underline" onClick={() => { state.discard(); onDiscard() }}>Discard changes</button>
      </div>
    </div>}
  </>
}

/** Reads as text until hovered, then shows its chrome. Saves on change. */
export function InlineSelect({ label, value, options, accent = false, disabled = false, onSave }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  accent?: boolean
  disabled?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const state = useFieldSave(async next => { await onSave(next); setDraft(null) })
  return <div>
    <div className={cn(ROW, 'hover:bg-muted')}>
      <span className={LABEL}>{label}</span>
      <select
        aria-label={label}
        aria-invalid={Boolean(state.error)}
        value={draft ?? value}
        disabled={disabled || state.status === 'saving'}
        onChange={event => { setDraft(event.target.value); void state.save(event.target.value) }}
        className={cn('h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] hover:border-input hover:bg-background focus:border-ring focus:outline-none', accent && 'font-semibold text-primary')}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    <FieldSaveStatus label={label} state={state} onDiscard={() => setDraft(null)} />
  </div>
}

export function InlineDate({ label, value, emphasized = false, derived = false, hideWhenEmpty = false, onSave }: {
  label: string
  /** YYYY-MM-DD, or empty when unset. */
  value: string
  emphasized?: boolean
  derived?: boolean
  hideWhenEmpty?: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSaved = useRef(value)
  const state = useFieldSave(async next => { await onSave(next); lastSaved.current = next })
  useEffect(() => { lastSaved.current = value }, [value])
  if (hideWhenEmpty && !value && state.status === 'idle') return null
  return <div>
    <div className={cn(ROW, 'hover:bg-muted')}>
      <span className={cn(LABEL, emphasized && 'font-semibold text-foreground')}>
        {label}
        {derived && <span className="ml-1 text-[9.5px] font-semibold uppercase tracking-[.05em] text-primary">auto</span>}
      </span>
      <input
        ref={inputRef}
        type="date"
        aria-label={label}
        aria-invalid={Boolean(state.error)}
        disabled={state.status === 'saving'}
        key={value}
        defaultValue={value}
        // Partial years and mid-entry blanks must never overwrite a stored date.
        onChange={event => {
          const next = event.target.value
          if (isSettledDateEntry(next) && next !== lastSaved.current) void state.save(next)
        }}
        onBlur={event => {
          if (event.target.validity?.badInput || state.error) return
          const next = event.target.value
          if (next !== lastSaved.current && (next === '' || isSettledDateEntry(next))) void state.save(next)
        }}
        className={cn('h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] tabular-nums hover:border-input hover:bg-background focus:border-ring focus:outline-none', emphasized && 'border-input bg-background font-semibold text-primary')}
      />
    </div>
    <FieldSaveStatus label={label} state={state} onDiscard={() => { if (inputRef.current) inputRef.current.value = value }} />
  </div>
}
