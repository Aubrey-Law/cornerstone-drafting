'use client'

import { cn, formatDate } from '@/lib/utils'
import { firmTodayKey } from '@/lib/firmDate'
import { PROBATE_STAGE_LABEL, readProbateStage } from '@/lib/probateStages/model'
import type { MatterDetailsRow } from '@/types/matter-details'

const PILL_CLASS = 'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold'

function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', className)} />
}

/**
 * A probate matter's stage strip. It is read from the dates on the record,
 * not set by hand: recording the petition, appointment, inventory or
 * distribution date in Probate essentials moves it. An earlier event with no
 * date while a later one is recorded shows as a gap to fill in.
 */
export function ProbateStageStrip({ details }: { details: MatterDetailsRow | null }) {
  const reading = readProbateStage(details, firmTodayKey())
  const current = reading.steps.find(step => step.state === 'current')
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-testid="probate-stage-strip">
      <p className="text-sm"><span className="text-muted-foreground">Current stage</span>{' '}<strong>{current?.label ?? 'Opening'}</strong></p>
      <details className="order-last w-full">
        <summary className="w-fit cursor-pointer rounded py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Full lifecycle</summary>
      <ol aria-label="Probate progress" className="mt-2 flex w-full flex-wrap items-center gap-1 pb-2">
        {reading.steps.map(step => {
          const when = step.reachedOn && step.reachedOn !== 'recorded' ? formatDate(step.reachedOn) : null
          return (
            <li key={step.key}>
              <span
                aria-current={step.state === 'current' ? 'step' : undefined}
                title={step.state === 'gap' ? 'No date recorded' : when ?? undefined}
                className={cn(
                  PILL_CLASS,
                  step.state === 'done' && 'bg-green-bg text-green',
                  step.state === 'current' && 'bg-stage-active-bg text-stage-active-text',
                  step.state === 'upcoming' && 'bg-muted text-muted-foreground',
                  step.state === 'gap' && 'bg-amber-bg text-amber',
                )}
              >
                <Dot className={cn(
                  step.state === 'done' && 'bg-green',
                  step.state === 'current' && 'bg-stage-active',
                  step.state === 'upcoming' && 'bg-border-strong',
                  step.state === 'gap' && 'bg-amber',
                )} />
                {step.label}
                {step.state === 'done' && <span className="sr-only"> (done)</span>}
                {step.state === 'gap' && <span className="sr-only"> (no date recorded)</span>}
              </span>
            </li>
          )
        })}
      </ol>
      </details>
      <p className="text-micro text-muted-foreground">
        {reading.gaps.length > 0 && (
          <span className="text-amber">
            No date recorded for {reading.gaps.map(key => PROBATE_STAGE_LABEL[key].toLowerCase()).join(', ')}.{' '}
          </span>
        )}
        {reading.nextStep ? `Next: ${reading.nextStep}` : 'The estate is closed.'}
        {' '}Stages follow the dates in Probate essentials.
      </p>
    </div>
  )
}
