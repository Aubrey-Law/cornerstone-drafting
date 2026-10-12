'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface DesignSheetBlockerRow {
  id: string
  label: string
  /** First field row is the old "next unresolved" jump, named for assistive tech. */
  nextUnresolved?: boolean
  onSelect: () => void
}

interface DesignSheetActionBarProps {
  rows: DesignSheetBlockerRow[]
  saveStatusText: string
  onSaveAndCheck: () => void
  complete: ReactNode
  menu: ReactNode
}

/**
 * One design-sheet control row: the blocking count opens the checklist,
 * and save, complete, and the save time sit on the right.
 */
export function DesignSheetActionBar({
  rows,
  saveStatusText,
  onSaveAndCheck,
  complete,
  menu,
}: DesignSheetActionBarProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const count = rows.length

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="relative min-w-0">
        {count > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-w-full text-warning"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(current => !current)}
          >
            {count} decision{count === 1 ? '' : 's'} block{count === 1 ? 's' : ''} drafting
          </Button>
        ) : (
          <p className="text-sm font-semibold text-success">Ready to draft</p>
        )}
        {open && count > 0 ? (
          <ul
            id={listId}
            aria-label="Unresolved decisions"
            className="absolute left-0 top-full z-50 mt-1 max-h-72 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {rows.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent',
                    row.id === 'matter-type' ? 'font-medium text-warning' : 'text-foreground',
                  )}
                  aria-label={row.nextUnresolved ? `Next unresolved decision, ${row.label}` : undefined}
                  onClick={() => {
                    setOpen(false)
                    row.onSelect()
                  }}
                >
                  {row.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" onClick={onSaveAndCheck}>Save and check drafts</Button>
        {complete}
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{saveStatusText}</p>
        {menu}
      </div>
    </div>
  )
}
