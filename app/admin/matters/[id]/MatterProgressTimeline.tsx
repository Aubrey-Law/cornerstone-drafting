import { cn, formatDate } from '@/lib/utils'
import { formatFirmDate } from '@/lib/format'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterStage, PipelineMatter } from '@/types/database'

/** A plain date reads as itself; a timestamp as the firm's calendar day. */
function stepDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDate(value)
    : formatFirmDate(value, { month: 'numeric', day: 'numeric', year: 'numeric' })
}

const STAGE_ORDER: MatterStage[] = [
  'intake',
  'intake_review',
  'design',
  'drafting',
  'client_review',
  'drafts_approved',
  'revision',
  'signing_scheduled',
  'signing_complete',
  'post_execution',
  'closed',
]

export function MatterProgressTimeline({
  matter,
  details,
  intakeCompletedAt,
}: {
  matter: PipelineMatter
  details: MatterDetailsRow | null
  intakeCompletedAt?: string | null
}) {
  const currentIndex = Math.max(0, STAGE_ORDER.indexOf(matter.stage))
  const targetSigning = details?.scheduled_signing_date ?? null
  const actualSigning = matter.signing_date ?? details?.signing_date ?? null
  // Intake is a fact, not a stage: a matter moved past it without the client
  // submitting one must not show it done. The other steps follow the stage.
  const steps: { label: string; at: string | null | undefined; target?: string | null; threshold: number; needsDate?: boolean }[] = [
    { label: 'Opened', at: details?.open_date ?? matter.matter_created, threshold: 0 },
    { label: 'Intake', at: intakeCompletedAt ?? matter.intake_submitted_at, threshold: 1, needsDate: true },
    { label: 'Drafting', at: details?.design_meeting_date ?? null, threshold: 2 },
    { label: 'Signing', at: actualSigning, target: targetSigning, threshold: 7 },
    { label: 'Closed', at: details?.closed_date ?? null, threshold: 10 },
  ]
  const currentStep = [...steps].reverse().findIndex(step => currentIndex >= step.threshold)
  const activeIndex = currentStep === -1 ? 0 : steps.length - 1 - currentStep

  return (
    <ol className="grid grid-cols-5 rounded-lg border border-border bg-card px-3 py-3 md:px-5">
      {steps.map((step, index) => {
        const passed = index < activeIndex
        const skipped = passed && step.needsDate && !step.at
        const complete = passed && !skipped
        const current = index === activeIndex
        return (
          <li key={step.label} className="relative min-w-0 text-center">
            {index > 0 && <span className="absolute left-0 top-2 h-px w-1/2 bg-border" />}
            {index < steps.length - 1 && <span className="absolute right-0 top-2 h-px w-1/2 bg-border" />}
            <span
              className={cn(
                'relative z-10 mx-auto block h-4 w-4 rounded-full border-2',
                complete && 'border-primary bg-primary',
                current && 'border-primary bg-card',
                !complete && !current && 'border-muted-foreground/30 bg-muted',
              )}
            />
            <span className="mt-1.5 block truncate text-micro font-medium">{step.label}</span>
            {/* Date only: the time made "Opened" truncate on a phone. */}
            <span className="block truncate text-micro text-muted-foreground">
              {step.at ? stepDate(step.at) : skipped ? 'Not received' : '—'}
            </span>
            {step.target && (
              <span className="block truncate text-micro text-muted-foreground">
                Target {formatDate(step.target)}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
