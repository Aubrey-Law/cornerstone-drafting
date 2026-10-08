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

  return (
    <>
      <div className="flex items-end gap-4 py-2">
        <p className="min-w-0 flex-1 text-sm sm:hidden"><span className="block text-xs text-muted-foreground">Current stage</span><strong>{STAGES[currentIndex]?.label ?? 'Choose work stage'}</strong></p>
        <div className="hidden min-w-0 flex-1 overflow-x-auto pb-1 sm:block">
          <ol aria-label="Matter progress" className="flex min-w-[880px] gap-1">
            {STAGES.map((entry, index) => {
              const isCurrent = index === currentIndex
              const isSkipped = skipped.has(entry.key)
              const visited = history.some(item => item.stage === entry.key) || seenStages.includes(entry.key)
              return <li key={entry.key} className="min-w-max flex-1">
                <button type="button" aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`${entry.label}${isSkipped ? ' (skipped)' : ''}`}
                  title={entry.key === 'closed' ? 'Close from Billing after close-out checks' : isSkipped ? 'Skipped' : `Change stage to ${entry.label}`}
                  disabled={stageSaving || stage === 'closed' || entry.key === 'closed'}
                  onClick={() => { setSelectedStage(entry.key); setChangeOpen(true) }}
                  className={cn('w-full rounded-sm text-left text-micro focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default', isCurrent ? 'font-semibold text-selected-foreground' : 'text-muted-foreground')}>
                  <span className="block whitespace-nowrap pb-2 pr-2">{entry.label}</span>
                  <span aria-hidden className={cn('block h-1 rounded-full', isCurrent ? 'bg-selected-border' : index < currentIndex && visited ? 'bg-muted-foreground' : 'bg-border')} />
                </button>
              </li>
            })}
          </ol>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">{agingSummary ? `${agingSummary.daysInStage} business days in stage` : 'Stage age unavailable'}</p>
          {targetSigning && <p className="text-xs text-muted-foreground">Signing {formatDate(targetSigning)}</p>}
          <Button type="button" size="sm" variant="ghost" className="h-6 px-0 text-xs" disabled={stageSaving || stage === 'closed'} onClick={() => setDialogOpen(true)}>
            {currentIndex < 0 ? 'Choose work stage' : 'Change stage'}
          </Button>
        </div>
      </div>

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
