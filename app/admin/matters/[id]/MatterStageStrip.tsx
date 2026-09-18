'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, formatDate } from '@/lib/utils'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import { STAGES, stageGroupColor, type MatterStage } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

/** Visible pill budget, counting the `+N earlier` roll-up as one. */
const MAX_PILLS = 7

interface MatterStageStripProps {
  stage: MatterStage
  details: MatterDetailsRow | null
  agingSummary: MatterAgingSummary | null
  stageSaving: boolean
  onStageChange: (stage: MatterStage) => void
}

function Dot({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', className)} style={style} />
}

const PILL_CLASS =
  'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold transition-opacity ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'

export function MatterStageStrip({
  stage,
  details,
  agingSummary,
  stageSaving,
  onStageChange,
}: MatterStageStripProps) {
  const [changeOpen, setChangeOpen] = useState(false)
  const [selectedStage, setSelectedStage] = useState<MatterStage>(stage)
  const currentIndex = Math.max(0, STAGES.findIndex(s => s.key === stage))
  // Only a *completed* run may roll up, so an early-stage matter shows the full
  // strip (wrapping) rather than hiding stages it has not reached yet.
  const collapsible = Math.min(currentIndex, STAGES.length - (MAX_PILLS - 1))
  const collapseCount = collapsible >= 2 ? collapsible : 0
  const collapsed = STAGES.slice(0, collapseCount)
  const visible = STAGES.slice(collapseCount)
  const targetSigning = details?.scheduled_signing_date ?? null
  const editableStages = STAGES.filter(entry => entry.key !== 'closed')

  function setDialogOpen(open: boolean) {
    setChangeOpen(open)
    if (open) setSelectedStage(stage === 'closed' ? 'funding' : stage)
  }

  function confirmStageChange() {
    if (selectedStage === stage || stageSaving) return
    onStageChange(selectedStage)
    setChangeOpen(false)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ol aria-label="Matter progress" className="flex flex-wrap items-center gap-1">
        {collapsed.length > 0 && (
          <li>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className={cn(PILL_CLASS, 'cursor-default bg-green-bg text-green')}
                >
                  <Dot className="bg-green" />
                  +{collapsed.length} earlier
                </span>
              </TooltipTrigger>
              <TooltipContent>{collapsed.map(s => s.label).join(' · ')}</TooltipContent>
            </Tooltip>
          </li>
        )}
        {visible.map(entry => {
          const index = STAGES.findIndex(s => s.key === entry.key)
          const isCurrent = index === currentIndex
          const isComplete = index < currentIndex
          const colors = stageGroupColor(entry.key)

          return (
            <li key={entry.key}>
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  PILL_CLASS,
                  isComplete && 'bg-green-bg text-green',
                  !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
                )}
                style={isCurrent ? { background: colors.bg, color: colors.text } : undefined}
              >
                <Dot
                  className={cn(
                    isComplete && 'bg-green',
                    !isComplete && !isCurrent && 'bg-border-strong',
                  )}
                  style={isCurrent ? { background: colors.dot } : undefined}
                />
                {entry.label}
              </span>
            </li>
          )
        })}
        </ol>
        <div className="ml-auto flex items-center gap-3">
          <p className="text-micro text-muted-foreground">
            {agingSummary
              ? `${agingSummary.daysInStage} business day${agingSummary.daysInStage === 1 ? '' : 's'} in stage`
              : 'Stage age unavailable'}
            {targetSigning && ` · target signing ${formatDate(targetSigning)}`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={stageSaving || stage === 'closed'}
            onClick={() => setDialogOpen(true)}
          >
            {stageSaving ? 'Saving stage…' : 'Change stage'}
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
