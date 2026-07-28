import type { LeadListRow } from '@/lib/leads/viewTypes'

type StepState = 'done' | 'pending' | 'todo'

const STEP_DOT: Record<StepState, string> = {
  done: 'bg-green border-green',
  pending: 'bg-amber-orange border-amber-orange',
  todo: 'border-border-strong bg-transparent',
}
const STEP_TEXT: Record<StepState, string> = {
  done: 'text-green',
  pending: 'text-amber',
  todo: 'text-muted-foreground',
}

export function isLeadIntakeComplete(lead: LeadListRow): boolean {
  return Boolean(lead.intake_completed_at) || lead.status === 'completed'
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000))
}

function intakeStep(lead: LeadListRow): { state: StepState; label: string } {
  if (isLeadIntakeComplete(lead)) return { state: 'done', label: 'Intake' }
  if (lead.intake_sent_at) {
    return { state: 'pending', label: `Intake · sent ${daysSince(lead.intake_sent_at)}d` }
  }
  return { state: 'todo', label: 'Intake' }
}

function engagementStep(lead: LeadListRow): { state: StepState; label: string } {
  if (lead.engagement_status === 'signed') return { state: 'done', label: 'Engagement' }
  if (lead.engagement_status === 'declined') return { state: 'pending', label: 'Engagement · declined' }
  if (lead.engagement_sent_at) {
    return { state: 'pending', label: `Engagement · sent ${daysSince(lead.engagement_sent_at)}d` }
  }
  return { state: 'todo', label: 'Engagement' }
}

function Step({ state, label }: { state: StepState; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${STEP_TEXT[state]}`}>
      <span className={`size-2 rounded-full border-[1.5px] ${STEP_DOT[state]}`} />
      {label}
    </span>
  )
}

export function LeadProgress({ lead }: { lead: LeadListRow }) {
  const intake = intakeStep(lead)
  const engagement = engagementStep(lead)
  const hired: StepState = lead.lead_status === 'hired' ? 'done' : 'todo'

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]">
      <Step state={intake.state} label={intake.label} />
      <span className="h-px w-3 bg-border" />
      <Step state={engagement.state} label={engagement.label} />
      <span className="h-px w-3 bg-border" />
      <Step state={hired} label="Hired" />
    </span>
  )
}
