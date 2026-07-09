export const EMAIL_CATEGORIES = [
  'message_alert',
  'portal_message_notice',
  'intake_complete_alert',
  'intake_invite',
  'manual',
] as const

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]

export function isEmailCategory(value: unknown): value is EmailCategory {
  return typeof value === 'string' && (EMAIL_CATEGORIES as readonly string[]).includes(value)
}
