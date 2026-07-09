export const EMAIL_CATEGORIES = [
  'message_alert',
  'portal_message_notice',
  'intake_complete_alert',
  'intake_invite',
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
