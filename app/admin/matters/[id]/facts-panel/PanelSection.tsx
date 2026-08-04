'use client'

import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One collapsible card in the facts panel. A controlled disclosure rather than
 * a native <details> — open state lives in useSectionState so it can persist.
 */
export function PanelSection({
  id,
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  /** Right-side summary, the point of which is to stay useful while collapsed. */
  hint?: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-content`}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {title}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </span>
        </button>
      </h3>
      {open && (
        <div id={`${id}-content`} className="px-2.5 pb-3">
          {children}
        </div>
      )}
    </section>
  )
}
