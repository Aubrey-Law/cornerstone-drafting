'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function ReadFirstPanel({
  title,
  description,
  children,
  readView,
  savingField,
  lastSavedAt,
  error,
}: {
  title: string
  description?: string
  children: React.ReactNode
  readView: React.ReactNode
  savingField?: string | null
  lastSavedAt?: string | null
  error?: string | null
}) {
  const [editing, setEditing] = useState(false)
  const saveStatus = savingField
    ? 'Saving…'
    : error
      ? error
      : lastSavedAt
        ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : null

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(value => !value)}
        >
          {editing ? 'Done' : 'Edit'}
        </Button>
      </div>
      <div className="p-4 md:p-5">{editing ? children : readView}</div>
      {(saveStatus || error) && (
        <div
          className={`border-t px-4 py-2 text-xs md:px-5 ${error ? 'border-red-strong-border text-red-strong' : 'border-border text-muted-foreground'}`}
          role={error ? 'alert' : 'status'}
        >
          {saveStatus}
        </div>
      )}
    </section>
  )
}

export function ReadValue({
  label,
  value,
  tabular = false,
}: {
  label: string
  value: React.ReactNode
  tabular?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm ${tabular ? 'tabular-nums' : ''}`}>{value || '—'}</dd>
    </div>
  )
}
