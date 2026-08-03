export const EMAIL_CATEGORIES = [
  'message_alert',
  'portal_message_notice',
  'document_shared_notice',
  'intake_complete_alert',
  'intake_invite',
  'retell_call_alert',
  'daily_digest',
  'appointment_confirmation',
  'appointment_booked_alert',
  'appointment_reminder',
  'appointment_missed_followup',
  'scheduling_link',
  'sla_task_nudge',
  'sla_task_internal_reminder',
  'manual',
] as const

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]
export type EmailMode = 'on' | 'off' | 'redirect'
export type EmailProvider = 'resend' | 'graph'

export const EMAIL_PROVIDERS: readonly EmailProvider[] = ['resend', 'graph'] as const

export function isEmailProvider(value: unknown): value is EmailProvider {
  return value === 'resend' || value === 'graph'
}

export interface EmailCategoryMeta {
  category: EmailCategory
  label: string
  description: string
  recipient: 'client' | 'internal'
}

export const EMAIL_CATEGORY_META: Record<EmailCategory, EmailCategoryMeta> = {
  message_alert: {
    category: 'message_alert',
    label: 'Client portal message alert',
    description: 'Sent to the firm when a client posts a new message in the portal.',
    recipient: 'internal',
  },
  portal_message_notice: {
    category: 'portal_message_notice',
    label: 'Client portal message notice',
    description: 'Sent to a client when the firm posts a new message in their portal conversation.',
    recipient: 'client',
  },
  document_shared_notice: {
    category: 'document_shared_notice',
    label: 'Document shared notice',
    description: 'Sent to a client when the firm shares a document to their portal.',
    recipient: 'client',
  },
  intake_complete_alert: {
    category: 'intake_complete_alert',
    label: 'Intake completed alert',
    description: 'Sent to the firm when a client submits their intake questionnaire.',
    recipient: 'internal',
  },
  intake_invite: {
    category: 'intake_invite',
    label: 'Intake questionnaire invitation',
    description: 'Sent to a client with the secure link to complete their intake questionnaire.',
    recipient: 'client',
  },
  retell_call_alert: {
    category: 'retell_call_alert',
    label: 'Retell post-call alert',
    description: 'Sent to the firm when Retell finishes post-call analysis on a receptionist call.',
    recipient: 'internal',
  },
  daily_digest: {
    category: 'daily_digest',
    label: 'Daily digest',
    description: 'Weekday-morning summary of overdue matters, unread messages, and intakes waiting on review.',
    recipient: 'internal',
  },
  appointment_confirmation: {
    category: 'appointment_confirmation',
    label: 'Appointment confirmation',
    description: 'Sent to a client after they book an appointment through the scheduling page.',
    recipient: 'client',
  },
  appointment_booked_alert: {
    category: 'appointment_booked_alert',
    label: 'Appointment booked alert',
    description: 'Sent to the firm when a client books, reschedules, or cancels an appointment.',
    recipient: 'internal',
  },
  appointment_reminder: {
    category: 'appointment_reminder',
    label: 'Appointment reminder',
    description: 'Sent to a client ahead of an upcoming appointment (lead time set in Scheduling settings).',
    recipient: 'client',
  },
  appointment_missed_followup: {
    category: 'appointment_missed_followup',
    label: 'Missed appointment follow-up',
    description: 'Sent to a client after staff marks an appointment as a no-show, with a rebook link.',
    recipient: 'client',
  },
  scheduling_link: {
    category: 'scheduling_link',
    label: 'Scheduling link',
    description: 'Sent to a client or lead with a Calendly link to book an appointment.',
    recipient: 'client',
  },
  sla_task_nudge: {
    category: 'sla_task_nudge',
    label: 'SLA task nudge',
    description:
      'Sent to a client when an SLA task they own reaches its nudge or escalation date without a response.',
    recipient: 'client',
  },
  sla_task_internal_reminder: {
    category: 'sla_task_internal_reminder',
    label: 'SLA task internal reminder',
    description: 'Sent to the firm when an attorney-owned SLA task reaches its nudge date.',
    recipient: 'internal',
  },
  manual: {
    category: 'manual',
    label: 'Manual one-off send',
    description: 'Ad-hoc email composed by staff from a matter detail page.',
    recipient: 'client',
  },
}

export function isEmailCategory(value: unknown): value is EmailCategory {
  return typeof value === 'string' && (EMAIL_CATEGORIES as readonly string[]).includes(value)
}
