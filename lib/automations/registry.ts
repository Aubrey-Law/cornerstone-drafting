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

export const AUTOMATION_TEMPLATES: Array<{
  key: string
  name: string
  description: string
  triggerKey: AutomationTriggerKey
  actionKey: AutomationActionKey
  approvalPolicy: 'automatic' | 'required'
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

export const SYSTEM_AUTOMATIONS = [
  { key: 'work-graph-shadow', name: 'Command center shadow audit', schedule: 'Weekdays at 7:45 AM ET', path: '/api/cron/work-graph-shadow' },
  { key: 'daily-digest', name: 'Daily digest', schedule: 'Weekdays at 8:00 AM ET', path: '/api/cron/daily-digest' },
  { key: 'sla-task-nudges', name: 'SLA task nudges', schedule: 'Weekdays at 8:00 AM ET', path: '/api/cron/sla-task-nudges' },
  { key: 'appointment-reminders', name: 'Appointment reminders', schedule: 'Hourly', path: '/api/cron/appointment-reminders' },
  { key: 'calendar-week-review', name: 'Calendar week review', schedule: 'Weekly', path: '/api/cron/calendar-week-review' },
  { key: 'scheduled-emails', name: 'Scheduled emails', schedule: 'Every minute', path: '/api/cron/scheduled-emails' },
  { key: 'run-queue', name: 'Workflow run queue', schedule: 'Every minute', path: '/api/cron/run-queue' },
  { key: 'workflow-jobs', name: 'Durable workflow jobs', schedule: 'Every 5 minutes', path: '/api/cron/workflow-jobs' },
  { key: 'invoice-reminders', name: 'Invoice reminders', schedule: 'Hourly', path: '/api/cron/invoice-reminders' },
  { key: 'email-triage', name: 'Email triage', schedule: 'Twice each weekday morning', path: '/api/cron/email-triage' },
  { key: 'esign-reconcile', name: 'E-sign reconciliation', schedule: 'Every 10 minutes', path: '/api/cron/esign-reconcile' },
  { key: 'lawmatics-calendar', name: 'Lawmatics calendar sync', schedule: 'Every 10 minutes', path: '/api/cron/lawmatics-calendar' },
] as const

export function automationApprovalPolicy(action: AutomationActionKey): 'automatic' | 'required' {
  return action === 'propose_send_message' || action === 'propose_calendar_block' ? 'required' : 'automatic'
}
