import type { ActionAutonomy, ActionConfirmationPolicy, ActionRisk } from '@/lib/actions/types'

/**
 * The delegation dial, as pure rules. The server module reads the firm's
 * positions; this file decides what each position means for a given risk.
 */

export const ACTION_AUTONOMY_LEVELS: readonly ActionAutonomy[] = ['observe', 'propose', 'act_report', 'act_silent']

export const DEFAULT_ACTION_AUTONOMY: ActionAutonomy = 'propose'

export const AUTONOMY_LABELS: Record<ActionAutonomy, { label: string; description: string }> = {
  observe: {
    label: 'Observe',
    description: 'Record what would have been done. Nothing happens and nothing waits for you.',
  },
  propose: {
    label: 'Propose',
    description: 'Prepare it and wait for your click.',
  },
  act_report: {
    label: 'Act and report',
    description: 'Do it right away and list it in the morning digest and on Today, with undo where possible.',
  },
  act_silent: {
    label: 'Act silently',
    description: 'Do it right away. The audit log is the only trace.',
  },
}

const ORDER: Record<ActionAutonomy, number> = { observe: 0, propose: 1, act_report: 2, act_silent: 3 }

export function compareAutonomy(left: ActionAutonomy, right: ActionAutonomy): number {
  return ORDER[left] - ORDER[right]
}

export function minAutonomy(left: ActionAutonomy, right: ActionAutonomy): ActionAutonomy {
  return compareAutonomy(left, right) <= 0 ? left : right
}

export function parseActionAutonomy(value: unknown): ActionAutonomy | null {
  return typeof value === 'string' && (ACTION_AUTONOMY_LEVELS as readonly string[]).includes(value)
    ? value as ActionAutonomy
    : null
}

/**
 * The most the dial may ever grant for a risk level. Legal judgment stays with
 * the attorney: a stage change can be prepared but never taken unattended.
 * Something that leaves the firm can run, but never without being reported.
 */
export function autonomyCeilingForRisk(risk: ActionRisk): ActionAutonomy {
  switch (risk) {
    case 'read':
    case 'prepare':
    case 'internal_write':
      return 'act_silent'
    case 'external_write':
      return 'act_report'
    case 'legal_financial':
      return 'propose'
    case 'prohibited':
    default:
      return 'observe'
  }
}

export function clampAutonomy(level: ActionAutonomy, risk: ActionRisk): ActionAutonomy {
  return minAutonomy(level, autonomyCeilingForRisk(risk))
}

export function isActingAutonomy(level: ActionAutonomy): boolean {
  return level === 'act_report' || level === 'act_silent'
}

/** Confirmation a person must give when no dial is involved. */
export function confirmationPolicyForRisk(risk: ActionRisk): ActionConfirmationPolicy {
  if (risk === 'read' || risk === 'prepare') return 'automatic'
  if (risk === 'internal_write') return 'one_click'
  if (risk === 'external_write' || risk === 'legal_financial') return 'explicit'
  return 'never'
}

/**
 * Confirmation recorded on a proposal the dial produced. An acting position
 * needs none, because the attorney granted it in Settings; anything else keeps
 * the confirmation the risk level demands.
 */
export function confirmationPolicyForAutonomy(level: ActionAutonomy, risk: ActionRisk): ActionConfirmationPolicy {
  if (risk === 'prohibited') return 'never'
  if (isActingAutonomy(clampAutonomy(level, risk))) return 'automatic'
  return confirmationPolicyForRisk(risk)
}

export type ActionCatalogGroup = 'tasks' | 'planning' | 'records' | 'communications' | 'matters' | 'templates' | 'billing'

export const ACTION_CATALOG_GROUPS: Record<ActionCatalogGroup, string> = {
  communications: 'Communications',
  tasks: 'Tasks',
  matters: 'Matters and workflow',
  records: 'Records',
  planning: 'Daily plan',
  billing: 'Billing',
  templates: 'Templates',
}

export interface ActionCatalogEntry {
  label: string
  description: string
  group: ActionCatalogGroup
  /**
   * The position that applies before the firm has set one. Almost every
   * action starts at Propose; a transactional send the client themselves
   * triggered starts at Act and report so it keeps going out at once.
   */
  defaultAutonomy?: ActionAutonomy
}

/** Plain words for each registry action, for the settings page and the digest. */
export const ACTION_CATALOG: Record<string, ActionCatalogEntry> = {
  'task.create': { label: 'Create a task', description: 'Add a task to a lead or matter, optionally with a calendar block.', group: 'tasks' },
  'task.start': { label: 'Start a task', description: 'Move a task to in progress.', group: 'tasks' },
  'task.complete': { label: 'Complete a task', description: 'Mark a task done and queue its next occurrence.', group: 'tasks' },
  'task.delegate': { label: 'Reassign a task', description: 'Hand a task to another staff member.', group: 'tasks' },
  'work.override': { label: 'Snooze or block work', description: 'Change how an item appears in your focus view.', group: 'planning' },
  'daily_plan.commit': { label: 'Commit the daily plan', description: 'Lock the day’s plan as the agenda.', group: 'planning' },
  'daily_plan.close': { label: 'Close the day', description: 'Close the plan and carry work forward.', group: 'planning' },
  'daily_plan.calendar.sync': { label: 'Sync plan to calendar', description: 'Write committed focus blocks to Google Calendar as holds.', group: 'planning' },
  'calendar.hold.create': { label: 'Create a calendar hold', description: 'Block time on the firm calendar.', group: 'planning' },
  'lead.create': { label: 'Create a lead', description: 'Open a new lead record.', group: 'records' },
  'note.create': { label: 'Add an internal note', description: 'Write a note on a lead or matter.', group: 'records' },
  'sms.thread.link': { label: 'Link a text conversation', description: 'Attach a phone number’s thread to a lead, matter or contact.', group: 'records' },
  'email.draft.prepare': { label: 'Prepare an email draft', description: 'Write a draft for a lead; nothing is sent.', group: 'communications' },
  'email.draft.compose': {
    label: 'Prepare a client email draft',
    description: 'Write a draft into your composer for a lead or matter. Nothing is sent until you or the dial sends it, and a draft you already have open is never replaced.',
    group: 'communications',
    defaultAutonomy: 'act_report',
  },
  'email.draft.send': { label: 'Send an email draft', description: 'Send a prepared draft from the firm mailbox.', group: 'communications' },
  'email.triage.reply.send': { label: 'Send a triage reply', description: 'Send the drafted reply to an email from a client or lead, on its Gmail thread. Senders not matched to a client or lead always wait on the triage page.', group: 'communications' },
  'design_sheet.proposal.apply': {
    label: 'Apply design sheet decisions',
    description: 'Write proposed design-sheet fields from meeting notes or imported text. Legal judgment, so it is always reviewed field by field before anything is written.',
    group: 'matters',
  },
  'document_request.create': {
    label: 'Request a document from the client',
    description: 'Add an item to the list of things the client is asked to send, shown in their portal.',
    group: 'matters',
  },
  'portal.status.publish': {
    label: 'Tell the client where their plan stands',
    description: 'When a matter changes stage, draft a plain-language update from the record and post it to the client’s portal conversation. Client-facing, so it is reported whenever it runs unattended.',
    group: 'communications',
  },
  'signing.kit.prepare': {
    label: 'Prepare the signing-day kit',
    description: 'When a signing appointment is booked, open the matter’s signing record with the documents to be signed and add a task to print the kit. The kit page itself is always available from the Signing view.',
    group: 'matters',
  },
  'signing.record.executed': {
    label: 'Record an executed document',
    description: 'Record what a scanned, executed original shows (signed when, how many witnesses, notarised) on the matter’s signing record. A claim about validity, so it is always confirmed by you from the reading.',
    group: 'matters',
  },
  'matter.stage.transition': { label: 'Change a matter stage', description: 'Move a matter to another pipeline stage.', group: 'matters' },
  'workflow.enqueue': { label: 'Queue a workflow', description: 'Seed a design sheet, SLA plan, stage task or annual review job.', group: 'matters' },
  'billing.reminders.prepare': { label: 'Prepare invoice reminders', description: 'Draft reminders for overdue client invoices; nothing is sent.', group: 'billing' },
  'appointment.confirmation.send': {
    label: 'Send an appointment confirmation',
    description: 'Email the client their booking or reschedule confirmation with the meeting details and manage link. Starts at Act and report so confirmations keep going out at once.',
    group: 'communications',
    defaultAutonomy: 'act_report',
  },
  'appointment.book': {
    label: 'Book an appointment',
    description: 'Book a discovery call or other appointment on a caller\u2019s behalf at the time they asked for. The slot is checked at booking time; the client gets the usual confirmation.',
    group: 'communications',
  },
  'scheduling.link.send': {
    label: 'Send a scheduling link',
    description: 'Email a lead or client the booking link for a meeting type.',
    group: 'communications',
  },
  'annual_review.outreach.send': { label: 'Send an annual review invitation', description: 'Email a client whose signed plan is a year old (and each cycle after) inviting a short review call, with a booking link.', group: 'communications' },
  'matter.closing.notice.send': { label: 'Send a closing notice', description: 'Tell a client their matter is complete: where their documents live, what to keep safe, and how long the firm keeps the file.', group: 'communications' },
  'billing.reminder.send': { label: 'Send an invoice reminder', description: 'Send a drafted overdue-invoice reminder with the invoice attached. Final notices always wait for you.', group: 'billing' },
  'template.register': { label: 'Register a template', description: 'Add an uploaded Word template to the firm library.', group: 'templates' },
}

export function actionLabel(actionKey: string): string {
  return ACTION_CATALOG[actionKey]?.label ?? actionKey
}

/** The position an action holds before the firm sets one. */
export function defaultAutonomyForAction(actionKey: string): ActionAutonomy {
  return ACTION_CATALOG[actionKey]?.defaultAutonomy ?? DEFAULT_ACTION_AUTONOMY
}
