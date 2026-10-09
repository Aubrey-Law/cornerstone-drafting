export const EMAIL_CATEGORIES = [
  'message_alert',
  'portal_message_notice',
  'document_shared_notice',
  'document_request_notice',
  'client_form_request',
  'intake_complete_alert',
  'intake_invite',
  'intake_invite_college_prep',
  'retell_call_alert',
  'daily_digest',
  'weekly_financial_snapshot',
  'appointment_confirmation',
  'appointment_booked_alert',
  'appointment_reminder',
  'appointment_missed_followup',
  'scheduling_link',
  'annual_review_outreach',
  'matter_closing_notice',
  'sla_task_nudge',
  'sla_task_internal_reminder',
  'invoice_sent',
  'invoice_reminder',
  'esign_signature_request',
  'esign_signature_reminder',
  'manual',
] as const

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]
export type EmailMode = 'on' | 'off' | 'redirect'
export type EmailProvider = 'resend' | 'gmail'

export const EMAIL_PROVIDERS: readonly EmailProvider[] = ['resend', 'gmail'] as const

export function isEmailProvider(value: unknown): value is EmailProvider {
  return value === 'resend' || value === 'gmail'
}

/**
 * Read a stored provider, mapping the retired Microsoft Graph value onto Gmail.
 *
 * Rows written before the firm left Microsoft 365 still say `graph`, and the
 * migration rewrites them — but a database that has not been pushed yet would
 * otherwise fall back to Resend and silently send client mail from the wrong
 * address. Every read of `email_settings.provider` goes through here.
 */
export function normalizeEmailProvider(value: unknown): EmailProvider {
  if (value === 'graph') return 'gmail'
  return isEmailProvider(value) ? value : 'resend'
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
  document_request_notice: {
    category: 'document_request_notice',
    label: 'Document request notice',
    description: 'Sent to a client when the firm asks them to send a document through their portal.',
    recipient: 'client',
  },
  client_form_request: {
    category: 'client_form_request',
    label: 'Client form request',
    description: 'Sent to a client when the firm sends them a form built in the form builder to fill out in their portal.',
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
  intake_invite_college_prep: {
    category: 'intake_invite_college_prep',
    label: 'College Prep intake invitation',
    description: 'Sent to a parent with the secure link to the College Preparation Plan questionnaire, and the context for why it matters at 18.',
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
  weekly_financial_snapshot: {
    category: 'weekly_financial_snapshot',
    label: 'Weekly financial snapshot',
    description: 'Monday-morning summary of the week just ended: collected, billed, costs, receivables and aging, plan claims, and the year against the goal.',
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
  annual_review_outreach: {
    category: 'annual_review_outreach',
    label: 'Annual review invitation',
    description: 'Sent to a client a year after their plan is signed (and on the configured cadence after), inviting a short review call.',
    recipient: 'client',
  },
  matter_closing_notice: {
    category: 'matter_closing_notice',
    label: 'Matter closing notice',
    description: 'Sent to a client when their matter closes: the work is complete, where their documents live, and how long the firm keeps the file.',
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
  invoice_sent: {
    category: 'invoice_sent',
    label: 'Invoice',
    description: 'Sent to a client when the firm issues an invoice, with the invoice attached.',
    recipient: 'client',
  },
  invoice_reminder: {
    category: 'invoice_reminder',
    label: 'Invoice payment reminder',
    description: 'Sent to a client when an issued invoice passes its due date and still owes a balance.',
    recipient: 'client',
  },
  esign_signature_request: {
    category: 'esign_signature_request',
    label: 'Signature request',
    // Both categories cover engagement agreements and any other document sent
    // for signature; the document path has shared them since it shipped.
    description: 'Sent to a signer with their one-time link to sign a document.',
    recipient: 'client',
  },
  esign_signature_reminder: {
    category: 'esign_signature_reminder',
    label: 'Signature reminder',
    description: 'Sent to a signer who has not yet signed, with a fresh link that replaces the last one.',
    recipient: 'client',
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
