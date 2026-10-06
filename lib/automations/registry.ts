export const AUTOMATION_TRIGGER_KEYS = [
  'lead_created',
  'appointment_booked',
  'intake_overdue',
  'engagement_signed',
  'stage_entered',
  'lead_stale',
  'communication_unanswered',
  'signing_completed',
  'annual_review_due',
  'invoice_overdue',
] as const

export const AUTOMATION_ACTION_KEYS = [
  'create_task',
  'draft_message',
  'propose_send_message',
  'enqueue_workflow',
  'propose_calendar_block',
] as const

export type AutomationTriggerKey = (typeof AUTOMATION_TRIGGER_KEYS)[number]
export type AutomationActionKey = (typeof AUTOMATION_ACTION_KEYS)[number]

/**
 * How a rule's proposals meet the delegation dial (Settings → Delegation).
 * `automatic` defers to the dial: the action's firm-wide position decides
 * whether it waits, runs, or is only recorded. `required` narrows it: the
 * proposal never passes "propose", so a person always clicks. `prohibited`
 * never runs live.
 */
export type AutomationApprovalPolicy = 'automatic' | 'required' | 'prohibited'

export const AUTOMATION_TEMPLATES: Array<{
  key: string
  name: string
  description: string
  triggerKey: AutomationTriggerKey
  actionKey: AutomationActionKey
  approvalPolicy: Exclude<AutomationApprovalPolicy, 'prohibited'>
}> = [
  { key: 'new-lead-intake', name: 'New lead intake', description: 'Create intake and follow-up work and prepare the intake message.', triggerKey: 'lead_created', actionKey: 'create_task', approvalPolicy: 'automatic' },
  { key: 'appointment-preparation', name: 'Appointment preparation', description: 'Build preparation work and identify missing information.', triggerKey: 'appointment_booked', actionKey: 'create_task', approvalPolicy: 'automatic' },
  { key: 'overdue-intake', name: 'Overdue intake reminder', description: 'Prepare the correct reminder without sending it.', triggerKey: 'intake_overdue', actionKey: 'draft_message', approvalPolicy: 'automatic' },
  { key: 'engagement-onboarding', name: 'Engagement onboarding', description: 'Propose conversion and onboarding work after signature.', triggerKey: 'engagement_signed', actionKey: 'enqueue_workflow', approvalPolicy: 'required' },
  { key: 'stage-entry', name: 'Stage entry checklist', description: 'Seed the allowlisted checklist for the entered stage.', triggerKey: 'stage_entered', actionKey: 'create_task', approvalPolicy: 'automatic' },
  { key: 'stale-lead-follow-up', name: 'Stale lead follow-up', description: 'Prepare a follow-up for stale open leads.', triggerKey: 'lead_stale', actionKey: 'draft_message', approvalPolicy: 'automatic' },
  { key: 'unanswered-message', name: 'Unanswered client message', description: 'Surface unanswered inbound communication in Today.', triggerKey: 'communication_unanswered', actionKey: 'create_task', approvalPolicy: 'automatic' },
  { key: 'signing-closeout', name: 'Signing closeout', description: 'Create closeout and funding work after signing.', triggerKey: 'signing_completed', actionKey: 'enqueue_workflow', approvalPolicy: 'required' },
  { key: 'annual-review', name: 'Annual review', description: 'Create the annual review plan when due.', triggerKey: 'annual_review_due', actionKey: 'create_task', approvalPolicy: 'automatic' },
  { key: 'overdue-invoice', name: 'Overdue invoice reminder', description: 'Prepare the approved collection message.', triggerKey: 'invoice_overdue', actionKey: 'draft_message', approvalPolicy: 'automatic' },
]

export interface SystemAutomationDefinition {
  key: string
  name: string
  scheduleLabel: string
  schedules: readonly string[]
  path: string
  expectedIntervalMinutes: number
}

export const SYSTEM_AUTOMATIONS: readonly SystemAutomationDefinition[] = [
  { key: 'work-graph-shadow', name: 'Command center shadow audit', scheduleLabel: 'Weekdays at 7:45 AM ET', schedules: ['45 11 * * 1-5'], path: '/api/cron/work-graph-shadow', expectedIntervalMinutes: 1440 },
  { key: 'daily-digest', name: 'Daily digest', scheduleLabel: 'Weekdays at 8:00 AM ET', schedules: ['0 12 * * 1-5'], path: '/api/cron/daily-digest', expectedIntervalMinutes: 1440 },
  { key: 'sla-task-nudges', name: 'SLA task nudges', scheduleLabel: 'Weekdays at 8:00 AM ET', schedules: ['0 12 * * 1-5'], path: '/api/cron/sla-task-nudges', expectedIntervalMinutes: 1440 },
  { key: 'appointment-reminders', name: 'Appointment reminders', scheduleLabel: 'Hourly', schedules: ['0 * * * *'], path: '/api/cron/appointment-reminders', expectedIntervalMinutes: 60 },
  { key: 'calendar-week-review', name: 'Calendar week review', scheduleLabel: 'Weekly', schedules: ['0 * * * 0'], path: '/api/cron/calendar-week-review', expectedIntervalMinutes: 10080 },
  { key: 'scheduled-emails', name: 'Scheduled emails', scheduleLabel: 'Every minute', schedules: ['* * * * *'], path: '/api/cron/scheduled-emails', expectedIntervalMinutes: 1 },
  { key: 'run-queue', name: 'Workflow run queue', scheduleLabel: 'Every minute', schedules: ['* * * * *'], path: '/api/cron/run-queue', expectedIntervalMinutes: 1 },
  { key: 'workflow-jobs', name: 'Durable workflow jobs', scheduleLabel: 'Every 5 minutes', schedules: ['*/5 * * * *'], path: '/api/cron/workflow-jobs', expectedIntervalMinutes: 5 },
  { key: 'invoice-reminders', name: 'Invoice reminders', scheduleLabel: 'Hourly at :15', schedules: ['15 * * * *'], path: '/api/cron/invoice-reminders', expectedIntervalMinutes: 60 },
  { key: 'email-triage', name: 'Email triage', scheduleLabel: 'Twice each weekday morning', schedules: ['30 11 * * 1-5', '15 12 * * 1-5'], path: '/api/cron/email-triage', expectedIntervalMinutes: 1425 },
  { key: 'esign-reconcile', name: 'E-sign reconciliation', scheduleLabel: 'Every 10 minutes', schedules: ['*/10 * * * *'], path: '/api/cron/esign-reconcile', expectedIntervalMinutes: 10 },
  { key: 'lawmatics-calendar', name: 'Lawmatics calendar sync', scheduleLabel: 'Every 10 minutes', schedules: ['*/10 * * * *'], path: '/api/cron/lawmatics-calendar', expectedIntervalMinutes: 10 },
  { key: 'automation-rules', name: 'Rule automation runner', scheduleLabel: 'Every 5 minutes', schedules: ['*/5 * * * *'], path: '/api/cron/automation-rules', expectedIntervalMinutes: 5 },
  { key: 'meeting-transcripts', name: 'Meeting transcripts', scheduleLabel: 'Every 30 minutes', schedules: ['*/30 * * * *'], path: '/api/cron/meeting-transcripts', expectedIntervalMinutes: 30 },
  { key: 'annual-review-outreach', name: 'Annual review outreach', scheduleLabel: 'Weekdays at 8:20 AM ET', schedules: ['20 12 * * 1-5'], path: '/api/cron/annual-review-outreach', expectedIntervalMinutes: 1440 },
  { key: 'file-retention', name: 'File retention review', scheduleLabel: 'Mondays at 8:40 AM ET', schedules: ['40 12 * * 1'], path: '/api/cron/file-retention', expectedIntervalMinutes: 10080 },
] as const

export function getSystemAutomation(key: string): SystemAutomationDefinition | null {
  return SYSTEM_AUTOMATIONS.find(automation => automation.key === key) ?? null
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === '*') return true
  if (field.startsWith('*/')) {
    const step = Number(field.slice(2))
    return Number.isInteger(step) && step > 0 && value % step === 0
  }
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number)
    return Number.isInteger(start) && Number.isInteger(end) && value >= start && value <= end
  }
  return field.split(',').some(entry => Number(entry) === value)
}

export function nextCronOccurrence(expression: string, from = new Date()): Date | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const cursor = new Date(from)
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  for (let minute = 0; minute < 8 * 24 * 60; minute += 1) {
    if (
      cronFieldMatches(fields[0], cursor.getUTCMinutes())
      && cronFieldMatches(fields[1], cursor.getUTCHours())
      && cronFieldMatches(fields[2], cursor.getUTCDate())
      && cronFieldMatches(fields[3], cursor.getUTCMonth() + 1)
      && cronFieldMatches(fields[4], cursor.getUTCDay())
    ) return cursor
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  }
  return null
}

export function nextSystemRunAt(key: string, from = new Date()): Date | null {
  const automation = getSystemAutomation(key)
  if (!automation) return null
  const occurrences = automation.schedules
    .map(schedule => nextCronOccurrence(schedule, from))
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime())
  return occurrences[0] ?? null
}

export function automationApprovalPolicy(action: AutomationActionKey): Exclude<AutomationApprovalPolicy, 'prohibited'> {
  return action === 'propose_send_message' || action === 'propose_calendar_block' ? 'required' : 'automatic'
}
