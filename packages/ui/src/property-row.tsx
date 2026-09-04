import * as React from 'react'

import { cn } from './utils'

/**
 * A label/value row, and the list that holds a run of them.
 *
 * Two rules make a column of these scannable, and both are easy to lose:
 *
 * 1. **The label recedes and the value leads.** The label sits in a fixed gutter in
 *    muted text; the value is full strength. Reading down the column you see the
 *    data, not the field names.
 * 2. **Empty is an em dash, never "N/A" and never a blank.** A missing value still
 *    occupies its row, so the rows stay aligned and an empty field reads as
 *    "nothing recorded" rather than as a rendering bug.
 *
 * The fixed gutter is why these align at the baseline rather than centring: a value
 * that wraps to two lines keeps its first line level with its label.
 *
 * This replaces two hand-rolled versions that had already drifted — the local
 * `InfoRow` in `ContactSidePanel` and the read-only row in `facts-panel/InlineField`.
 */

export function PropertyList({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('space-y-2 text-sm', className)} {...props} />
}

export function PropertyLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('w-32 shrink-0 text-muted-foreground', className)}
      {...props}
    />
  )
}

export function PropertyValue({
  className,
  children,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span className={cn('min-w-0 flex-1 truncate', className)} {...props}>
      {children}
    </span>
  )
}

/** Rendered in place of a value that is absent, empty, or whitespace only. */
export function PropertyEmpty() {
  return (
    <span className="text-muted-foreground/60" aria-label="Not recorded">
      —
    </span>
  )
}

export interface PropertyRowProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  label: React.ReactNode
  /** Anything blank — null, undefined, or a whitespace-only string — renders the em dash. */
  value?: React.ReactNode
  children?: React.ReactNode
}

export function PropertyRow({
  label,
  value,
  children,
  className,
  ...props
}: PropertyRowProps) {
  const supplied = children ?? value
  const isBlank =
    supplied === null ||
    supplied === undefined ||
    supplied === false ||
    (typeof supplied === 'string' && supplied.trim().length === 0)

  return (
    <div className={cn('flex items-baseline gap-2', className)} {...props}>
      <PropertyLabel>{label}</PropertyLabel>
      <PropertyValue>{isBlank ? <PropertyEmpty /> : supplied}</PropertyValue>
    </div>
  )
}
