import { cn } from '@/lib/utils'
import { leadBoardColumn, LEAD_BOARD_COLUMNS, type LeadBoardColumnKey } from '@/lib/leads/board'
import type { LeadListRow } from '@/lib/leads/viewTypes'

/** The lead pipeline in order; Lost and Declined end it rather than sit on it. */
export const LEAD_STEPS = LEAD_BOARD_COLUMNS.filter(column => column.key !== 'lost' && column.key !== 'declined')

/** How far the lead got before it closed: the furthest step its record shows. */
function reachedStep(lead: LeadListRow): LeadBoardColumnKey {
  if (lead.engagement_sent_at || lead.engagement_status === 'signed') return 'engagement'
  if (lead.intake_completed_at || lead.status === 'completed') return 'intake_complete'
  if (lead.intake_sent_at) return 'intake_sent'
  return 'new'
}

/**
 * The lead's place in the pipeline, drawn like the matter stage stepper. It is
 * read-only: a lead moves by what happens to it (intake sent, engagement sent,
 * hired), which the Actions menu and the next action drive.
 */
export function LeadStageStepper({ lead, daysAsLead, lastContactDays }: {
  lead: LeadListRow
  daysAsLead: number
  lastContactDays: number | null
}) {
  const column = leadBoardColumn(lead)
  const closed = column === 'lost' || column === 'declined'
  const currentKey = closed ? reachedStep(lead) : column
  const currentIndex = LEAD_STEPS.findIndex(step => step.key === currentKey)
  const current = LEAD_STEPS[currentIndex]
  const stageText = closed ? (column === 'lost' ? 'Lost' : 'Declined') : current?.label ?? 'New'
  return (
    <div className="flex items-center gap-5">
      <p className="min-w-0 flex-1 text-sm sm:hidden">
        <span className="block text-xs text-muted-foreground">Current stage</span>
        <strong>{stageText}</strong>
      </p>
      <div className="hidden min-w-0 flex-1 overflow-x-auto sm:block">
        <ol aria-label="Lead progress" className="grid min-w-[420px] text-micro" style={{ gridTemplateColumns: `repeat(${LEAD_STEPS.length}, minmax(0, 1fr))` }}>
          {LEAD_STEPS.map((step, index) => {
            const isCurrent = !closed && index === currentIndex
            const passed = index < currentIndex || (closed && index === currentIndex)
            return (
              <li key={step.key} aria-current={isCurrent ? 'step' : undefined} title={step.hint}
                className={cn('flex min-w-0 flex-col gap-1.5', isCurrent ? 'font-semibold text-selected-foreground' : 'text-muted-foreground')}>
                <span aria-hidden className="flex items-center">
                  <span className={cn('size-3 shrink-0 rounded-full',
                    isCurrent ? 'border-[3px] border-selected-border bg-card' : passed ? 'bg-muted-foreground' : 'bg-border')} />
                  {index < LEAD_STEPS.length - 1 && <span className={cn('ml-1 h-0.5 flex-1', index < currentIndex ? 'bg-muted-foreground' : 'bg-border')} />}
                </span>
                <span className="block truncate pr-1">{step.label}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="shrink-0 text-right text-xs leading-snug text-muted-foreground">
        <p>
          <strong className={cn('hidden font-semibold sm:inline', closed ? 'text-destructive' : 'text-selected-foreground')}>{stageText}</strong>
          <span className="hidden sm:inline">{' · '}</span>
          Day {daysAsLead}
        </p>
        <p>{lastContactDays === null ? 'No client contact yet' : `Last contact ${lastContactDays === 0 ? 'today' : `${lastContactDays}d ago`}`}</p>
      </div>
    </div>
  )
}
