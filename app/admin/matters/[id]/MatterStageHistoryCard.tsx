'use client'

import { useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { STAGES } from '@/types/database'
import type { MatterStageHistoryEntry } from '@/lib/matters/stageTimeline'
import { cn, formatDateDetail } from '@/lib/utils'

/**
 * The recorded stage timeline for a matter — what nothing could show before
 * `matter_stage_history` existed: how long each stage actually lasted, whether
 * the matter was walked backwards, and who moved it.
 *
 * Newest first, because the recent moves are the ones being asked about.
 */

const VISIBLE_LIMIT = 6

/**
 * `from_stage`/`to_stage` are unconstrained text on purpose, so the record
 * survives a stage being renamed or retired. A key that is no longer in STAGES
 * still has to render, so fall back to title-casing it rather than showing a
 * raw slug.
 */
export function historicalStageLabel(key: string): string {
  const known = STAGES.find(stage => stage.key === key)
  if (known) return known.label
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
}

function duration(days: number, isCurrent: boolean): string {
  const unit = days === 1 ? 'day' : 'days'
  return isCurrent ? `${days} ${unit} so far` : `${days} ${unit}`
}

export function MatterStageHistoryCard({
  entries,
  className,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: {
  entries: MatterStageHistoryEntry[]
  className?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const [showAll, setShowAll] = useState(false)
  const open = controlledOpen ?? internalOpen

  function toggleOpen() {
    const nextOpen = !open
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  // Newest first for reading; the entries arrive oldest-first so durations could
  // be derived from the following transition.
  const newestFirst = [...entries].reverse()
  const visible = showAll ? newestFirst : newestFirst.slice(0, VISIBLE_LIMIT)
  const hidden = newestFirst.length - visible.length

  return (
    <div
      id="matter-stage-history"
      className={cn('scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="flex w-full items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Stage history</span>
        </span>
        <span className="text-micro font-semibold text-muted-foreground">
          {entries.length === 0
            ? 'No moves recorded'
            : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-4 py-3">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No stage moves recorded yet. Transitions are recorded from the moment a matter is
              created, so this fills in as the matter moves.
            </p>
          ) : (
            <>
              <ol className="relative space-y-4">
                <div className="absolute bottom-3 left-[11px] top-3 w-px bg-border" aria-hidden />
                {visible.map(entry => (
                  <li key={entry.id} className="relative flex gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        'relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                        entry.isCurrent
                          ? 'border-brand-teal/40 bg-teal-bg'
                          : 'border-border bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          entry.isCurrent ? 'bg-brand-teal' : 'bg-muted-foreground/50',
                        )}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">
                        {historicalStageLabel(entry.stage)}
                        {entry.isCurrent && (
                          <span className="ml-1.5 text-micro font-normal text-muted-foreground">current</span>
                        )}
                      </p>
                      <p className="text-micro text-muted-foreground">
                        {/* The earliest row is a starting point, not an observed
                            move — either the matter's creation or the row seeded
                            for a matter that predates the table. */}
                        {entry.isStart
                          ? `Recorded from ${formatDateDetail(entry.enteredAt)}`
                          : `Entered ${formatDateDetail(entry.enteredAt)}${
                              entry.fromStage ? ` from ${historicalStageLabel(entry.fromStage)}` : ''
                            }`}
                        {' · '}
                        {duration(entry.days, entry.isCurrent)}
                      </p>
                      {entry.actorName && (
                        <p className="text-micro text-muted-foreground">By {entry.actorName}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="rounded-sm text-micro font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Show {hidden} earlier {hidden === 1 ? 'entry' : 'entries'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
