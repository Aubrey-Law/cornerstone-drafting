'use client'

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
  const currentIndex = Math.max(0, STAGES.findIndex(s => s.key === stage))
  // Only a *completed* run may roll up, so an early-stage matter shows the full
  // strip (wrapping) rather than hiding stages it has not reached yet.
  const collapsible = Math.min(currentIndex, STAGES.length - (MAX_PILLS - 1))
  const collapseCount = collapsible >= 2 ? collapsible : 0
  const collapsed = STAGES.slice(0, collapseCount)
  const visible = STAGES.slice(collapseCount)
  const targetSigning = details?.scheduled_signing_date ?? null

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <ol className="flex flex-wrap items-center gap-1">
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
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={stageSaving}
                onClick={() => onStageChange(entry.key)}
                className={cn(
                  PILL_CLASS,
                  !stageSaving && 'hover:opacity-80',
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
              </button>
            </li>
          )
        })}
      </ol>
      <p className="ml-auto text-micro text-muted-foreground">
        {agingSummary
          ? `${agingSummary.daysInStage} business day${agingSummary.daysInStage === 1 ? '' : 's'} in stage`
          : 'Stage age unavailable'}
        {targetSigning && ` · target signing ${formatDate(targetSigning)}`}
      </p>
    </div>
  )
}
