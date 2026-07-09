import { getAdminClient } from '@/lib/supabaseAdmin'
import type { EmailCategory } from './categories'
import {
  renderEmailTemplateText,
  renderEmailTemplateBodyHtml,
  renderEmailTemplateBodyText,
  type EmailTemplateOption,
  type EmailTemplateVariables,
} from './templateShared'

interface EmailTemplateRow {
  id: string
  name: string
  category: EmailCategory
  subject: string
  body: string
  is_active: boolean
  is_default: boolean
  updated_at: string | null
}

function toOption(row: EmailTemplateRow): EmailTemplateOption {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subject: row.subject,
    body: row.body,
    isActive: row.is_active,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
  }
}

export async function getDefaultEmailTemplate(
  category: EmailCategory,
): Promise<EmailTemplateOption | null> {
  const { data, error } = await getAdminClient()
    .from('email_templates')
    .select('id, name, category, subject, body, is_active, is_default, updated_at')
    .eq('category', category)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle()

  if (error || !data) return null
  return toOption(data as EmailTemplateRow)
}

export function applyEmailTemplate(
  template: EmailTemplateOption,
  variables: EmailTemplateVariables = {},
): { subject: string; text: string; html: string } {
  const subject = renderEmailTemplateText(template.subject, variables)
  return {
    subject,
    text: renderEmailTemplateBodyText(template.body, variables),
    html: renderEmailTemplateBodyHtml(template.body, variables),
  }
}
