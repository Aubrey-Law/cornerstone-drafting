import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizeEmailHtml } from '@/lib/email/templateShared'

export type AutomationDraftPurpose = 'intake_reminder' | 'stale_lead_follow_up'

export interface AutomationLeadDraft {
  leadId: string
  recipient: string
  recipientName: string
  purpose: AutomationDraftPurpose
  subject: string
  bodyHtml: string
  sourceUpdatedAt: string
  existingDraftId: string | null
}

function firstName(row: { preferred_name?: string | null; first_name?: string | null; full_name?: string | null }) {
  return row.preferred_name?.trim() || row.first_name?.trim() || row.full_name?.trim().split(/\s+/)[0] || 'there'
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

export async function previewAutomationLeadDraft(
  admin: SupabaseClient,
  input: { leadId: string; purpose: AutomationDraftPurpose; actorId: string },
): Promise<AutomationLeadDraft> {
  const { data: lead, error } = await admin.from('client_intake')
    .select('id, email, preferred_name, first_name, full_name, lead_status, intake_sent_at, intake_completed_at, updated_at')
    .eq('id', input.leadId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!lead || lead.lead_status !== 'lead') throw new Error('Active lead not found')
  if (!lead.email?.trim()) throw new Error('Lead has no email address')

  const { data: existing, error: existingError } = await admin.from('email_drafts')
    .select('id, subject, body_html, updated_at')
    .eq('user_id', input.actorId)
    .eq('context_type', 'lead')
    .eq('context_id', input.leadId)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message)

  const name = firstName(lead)
  const safeName = escapeHtml(name)
  const generated = input.purpose === 'intake_reminder'
    ? {
        subject: 'Reminder to complete your intake questionnaire',
        bodyHtml: `<p>Hi ${safeName},</p><p>This is a friendly reminder to complete your intake questionnaire so we can keep your planning moving. If you have questions or need help, please reply and let us know.</p>`,
      }
    : {
        subject: 'Checking in about your estate planning',
        bodyHtml: `<p>Hi ${safeName},</p><p>I am checking in about your estate-planning inquiry. If you would still like to move forward, please reply and let us know the best next step for you.</p>`,
      }

  return {
    leadId: lead.id,
    recipient: lead.email.trim().toLowerCase(),
    recipientName: lead.full_name?.trim() || name,
    purpose: input.purpose,
    // Never replace work a person already prepared in the composer.
    subject: existing?.subject?.trim() || generated.subject,
    bodyHtml: existing?.body_html?.trim() || sanitizeEmailHtml(generated.bodyHtml),
    sourceUpdatedAt: lead.updated_at,
    existingDraftId: existing?.id ?? null,
  }
}

export async function prepareAutomationLeadDraft(
  admin: SupabaseClient,
  draft: AutomationLeadDraft,
  actorId: string,
) {
  if (draft.existingDraftId) {
    return { id: draft.existingDraftId, prepared: false, preservedExisting: true }
  }
  const { data, error } = await admin.from('email_drafts').insert({
    user_id: actorId,
    context_type: 'lead',
    context_id: draft.leadId,
    to_email: draft.recipient,
    cc: [],
    bcc: [],
    subject: draft.subject,
    body_html: draft.bodyHtml,
    document_ids: [],
    include_signature: true,
  }).select('id').single()
  if (error) {
    // A concurrent preparation may have won the context uniqueness race. It
    // is still a successful idempotent outcome and must not overwrite it.
    if (error.code === '23505') {
      const { data: existing } = await admin.from('email_drafts').select('id')
        .eq('user_id', actorId).eq('context_type', 'lead').eq('context_id', draft.leadId).maybeSingle()
      if (existing) return { id: existing.id, prepared: false, preservedExisting: true }
    }
    throw new Error(error.message)
  }
  return { id: data.id, prepared: true, preservedExisting: false }
}
