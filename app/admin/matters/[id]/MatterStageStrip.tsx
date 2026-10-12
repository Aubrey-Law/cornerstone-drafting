'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn, formatDate } from '@/lib/utils'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import { MATTER_WORK_STAGES as STAGES, type MatterStage } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterStageHistoryEntry } from '@/lib/matters/stageTimeline'

interface MatterStageStripProps {
  stage: MatterStage
  details: MatterDetailsRow | null
  agingSummary: MatterAgingSummary | null
  stageSaving: boolean
  onStageChange: (stage: MatterStage) => void
  /** Recorded stage history, to tell a stage passed through from one skipped. */
  history?: Pick<MatterStageHistoryEntry, 'stage' | 'enteredAt'>[]
  /** A single stage chip that opens the change-stage dialog, for routes that need the height (Drafting). */
  compact?: boolean
}

/**
 * Earlier stages the history shows the matter never entered — Revision when
 * the client approved first, or any stage jumped over. Only stages after the
 * first recorded one count: before it, the record says nothing either way.
 */
export function skippedStages(
  history: Pick<MatterStageHistoryEntry, 'stage' | 'enteredAt'>[],
  currentIndex: number,
  alsoVisited: Iterable<string> = [],
): Set<MatterStage> {
  // Lead stages (new_lead…) can open the record; start at the first one the
  // strip shows.
  const first = [...history]
    .filter(entry => STAGES.some(s => s.key === entry.stage))
    .sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt))[0]
  if (!first) return new Set()
  const firstIndex = STAGES.findIndex(s => s.key === first.stage)
  const visited = new Set<string>([...history.map(entry => entry.stage), ...alsoVisited])
  return new Set(
    STAGES.filter((s, index) => index > firstIndex && index < currentIndex && !visited.has(s.key)).map(s => s.key),
  )
}

export function MatterStageStrip({
  stage,
  details,
  agingSummary,
  stageSaving,
  onStageChange,
  history = [],
  compact = false,
}: MatterStageStripProps) {
  const [changeOpen, setChangeOpen] = useState(false)
  const [selectedStage, setSelectedStage] = useState<MatterStage>(stage)
  const currentIndex = STAGES.findIndex(s => s.key === stage)
  const targetSigning = details?.scheduled_signing_date ?? null
  const editableStages = STAGES.filter(entry => entry.key !== 'closed')
  // Stages entered on this visit, until the refreshed history includes them.
  const [seenStages, setSeenStages] = useState<MatterStage[]>([stage])
  useEffect(() => {
    setSeenStages(current => (current.includes(stage) ? current : [...current, stage]))
  }, [stage])
  const skipped = skippedStages(history, currentIndex, seenStages)

  function setDialogOpen(open: boolean) {
    setChangeOpen(open)
    if (open) setSelectedStage(stage === 'closed' ? 'funding' : currentIndex < 0 ? 'design' : stage)
  }

  function confirmStageChange() {
    if (selectedStage === stage || stageSaving) return
    onStageChange(selectedStage)
    setChangeOpen(false)
  }

  const stageSummary = `${STAGES[currentIndex]?.label ?? 'Choose work stage'}${agingSummary ? ` · ${agingSummary.daysInStage} business day${agingSummary.daysInStage === 1 ? '' : 's'} in stage` : ''}`
  const slaDays = agingSummary?.slaDays
  const slaLabel = slaDays != null && slaDays > 0 && agingSummary
    ? `${agingSummary.daysInStage} of ${slaDays}`
    : null
  const nearby = [
    currentIndex > 0 ? STAGES[currentIndex - 1] : null,
    currentIndex >= 0 ? STAGES[currentIndex] : null,
    currentIndex >= 0 && currentIndex < STAGES.length - 1 ? STAGES[currentIndex + 1] : null,
  ].filter((entry): entry is (typeof STAGES)[number] => entry != null)

  return (
    <>
      {compact ? (
        <button
          type="button"
          disabled={stageSaving || stage === 'closed'}
          onClick={() => setDialogOpen(true)}
          title={targetSigning ? `Target signing ${formatDate(targetSigning)} · change stage` : 'Change stage'}
          aria-label={`Stage: ${stageSummary}. Change stage`}
          className="inline-flex items-center gap-1.5 rounded-md border border-selected-border/40 bg-selected px-2 py-0.5 text-xs font-medium text-selected-foreground hover:bg-accent disabled:cursor-default"
        >
          <span aria-hidden className="size-2 rounded-full border-2 border-selected-border bg-card" />
          {stageSummary}
        </button>
      ) : (
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <ol aria-label="Matter progress" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {nearby.length === 0 ? (
            <li className="text-muted-foreground">Choose work stage</li>
          ) : nearby.map((entry, index) => {
            const isCurrent = entry.key === stage
            const isSkipped = !isCurrent && skipped.has(entry.key)
            return (
              <li key={entry.key} className="flex min-w-0 items-center gap-2" aria-current={isCurrent ? 'step' : undefined}>
                {index > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
                <span
                  title={isSkipped ? 'Skipped' : undefined}
                  className={cn(
                    'truncate',
                    isCurrent ? 'font-semibold text-selected-foreground' : 'text-muted-foreground',
                    isSkipped && 'line-through decoration-muted-foreground/60',
                  )}
                >
                  {entry.label}{isSkipped ? ' (skipped)' : ''}
                </span>
              </li>
            )
          })}
        </ol>
        <div className="shrink-0 text-right text-xs leading-snug text-muted-foreground">
          <p>
            {slaLabel
              ? <span title={`${slaLabel} business days in this stage`}>{slaLabel}</span>
              : agingSummary
                ? `${agingSummary.daysInStage} business day${agingSummary.daysInStage === 1 ? '' : 's'} in stage`
                : 'Stage age unavailable'}
          </p>
          <p>
            {targetSigning && <>Target signing {formatDate(targetSigning)}{' · '}</>}
            <Button type="button" variant="link" className="h-auto p-0 text-xs" disabled={stageSaving || stage === 'closed'} onClick={() => setDialogOpen(true)}>
              {currentIndex < 0 ? 'Choose work stage' : 'Change stage'}
            </Button>
          </p>
        </div>
      </div>
      )}

      <Dialog open={changeOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change matter stage</DialogTitle>
            <DialogDescription>
              Choose the stage that reflects the matter’s current work. This change is recorded in stage history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label htmlFor="matter-stage-change" className="text-sm font-medium">New stage</label>
            <select
              id="matter-stage-change"
              value={selectedStage}
              onChange={event => setSelectedStage(event.target.value as MatterStage)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {editableStages.map(entry => (
                <option key={entry.key} value={entry.key}>{entry.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Close this matter from Billing after completing the close-out checks.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={stageSaving || selectedStage === stage}
              onClick={confirmStageChange}
            >
              Confirm stage change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
