import { cn, formatDate, formatDateDetail } from '@/lib/utils'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterStage, PipelineMatter } from '@/types/database'

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
  const steps = [
    { label: 'Opened', at: details?.open_date ?? matter.matter_created, threshold: 0 },
    { label: 'Intake complete', at: intakeCompletedAt ?? matter.intake_submitted_at, threshold: 1 },
    { label: 'Drafting', at: details?.design_meeting_date ?? null, threshold: 2 },
    { label: 'Signing', at: actualSigning, target: targetSigning, threshold: 7 },
    { label: 'Closed', at: details?.closed_date ?? null, threshold: 10 },
  ]
  const currentStep = [...steps].reverse().findIndex(step => currentIndex >= step.threshold)
  const activeIndex = currentStep === -1 ? 0 : steps.length - 1 - currentStep

  return (
    <ol className="grid grid-cols-5 rounded-lg border border-border bg-card px-3 py-3 md:px-5">
      {steps.map((step, index) => {
        const complete = index < activeIndex
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
            <span className="mt-1.5 block truncate text-[11px] font-medium">{step.label}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {step.at ? formatDateDetail(step.at) : '—'}
            </span>
            {step.target && (
              <span className="block truncate text-[10px] text-muted-foreground">
                Target {formatDate(step.target)}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
