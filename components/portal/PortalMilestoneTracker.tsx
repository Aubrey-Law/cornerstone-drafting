import { Check } from 'lucide-react'
import { cva } from 'class-variance-authority'
import type { PortalMilestone } from '@/lib/portal/progress'

const markerVariants = cva(
  'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
  {
    variants: {
      state: {
        completed: 'border-primary bg-primary text-primary-foreground',
        current:
          'border-primary bg-card text-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_16%,transparent)]',
        pending: 'border-input bg-card text-muted-foreground',
      },
    },
  },
)

const labelVariants = cva('text-center text-micro leading-tight sm:text-xs', {
  variants: {
    state: {
      completed: 'font-medium text-foreground',
      current: 'font-semibold text-foreground',
      pending: 'text-muted-foreground',
    },
  },
})

const connectorVariants = cva('mt-[9px] h-0.5 min-w-2 flex-1 rounded-full', {
  variants: {
    done: {
      true: 'bg-primary',
      false: 'bg-border',
    },
  },
})

const STATUS_LABEL = {
  completed: 'Complete',
  current: 'Current step',
  pending: 'Not started',
} as const

/**
 * The first unfinished milestone is "current" only when every earlier one is
 * complete. A later recorded date must not paint an earlier gap as the step
 * the client is on.
 */
export function milestoneFrontier(milestones: readonly PortalMilestone[]): number {
  const frontier = milestones.findIndex(step => step.state !== 'completed')
  if (frontier < 0) return -1
  if (milestones[frontier]?.state === 'current') return frontier
  const laterCompleted = milestones.slice(frontier + 1).some(step => step.state === 'completed')
  return laterCompleted ? -1 : frontier
}

export function PortalMilestoneTracker({ milestones }: { milestones: readonly PortalMilestone[] }) {
  if (milestones.length === 0) {
    return (
      <p
        role="status"
        className="rounded-lg border border-dashed border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
      >
        The firm will share progress updates through Messages.
      </p>
    )
  }

  const frontier = milestoneFrontier(milestones)

  return (
    <ol aria-label="Plan progress" className="flex items-start">
      {milestones.map((step, index) => {
        const state = step.state === 'completed' ? 'completed' : index === frontier ? 'current' : 'pending'
        return (
          <li
            key={step.key}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex min-w-0 flex-1 items-start last:flex-none"
          >
            <div className="flex min-w-0 shrink flex-col items-center gap-1.5 px-0.5">
              <span aria-hidden className={markerVariants({ state })}>
                {state === 'completed' && <Check className="size-3" strokeWidth={3} />}
                {state === 'current' && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className={labelVariants({ state })}>
                <span className="sr-only">{STATUS_LABEL[state]}. </span>
                {step.label}
              </span>
            </div>
            {index < milestones.length - 1 && (
              <span aria-hidden className={connectorVariants({ done: state === 'completed' })} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
