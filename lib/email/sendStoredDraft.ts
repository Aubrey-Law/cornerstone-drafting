import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { emailTemplateHtmlToText, sanitizeEmailHtml } from '@/lib/email/templateShared'
import {
  loadMatterDocumentAttachments,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  totalAttachmentBytes,
} from '@/lib/email/attachments'
import type { ActionActor } from '@/lib/actions/types'
import { assembleManualEmail } from '@/lib/email/manualAssembly'

interface StoredEmailDraft {
  id: string
  user_id: string
  context_type: 'matter' | 'lead' | 'contact' | 'general'
  context_id: string | null
  to_email: string
  cc: string[] | null
  bcc: string[] | null
  subject: string
  body_html: string
  document_ids: string[] | null
  include_signature: boolean
  updated_at: string
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function loadStoredEmailDraft(
  admin: SupabaseClient,
  draftId: string,
  actorId: string,
): Promise<StoredEmailDraft> {
  const { data, error } = await admin.from('email_drafts')
    .select('id, user_id, context_type, context_id, to_email, cc, bcc, subject, body_html, document_ids, include_signature, updated_at')
    .eq('id', draftId).eq('user_id', actorId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Email draft not found')
  return data as StoredEmailDraft
}

export async function emailDraftPreview(draft: StoredEmailDraft) {
  const to = draft.to_email.trim()
  const subject = draft.subject.trim()
  const html = sanitizeEmailHtml(draft.body_html).trim()
  const text = emailTemplateHtmlToText(html).trim()
  const cc = draft.cc ?? []
  const bcc = draft.bcc ?? []
  if (!isEmail(to) || [...cc, ...bcc].some(address => !isEmail(address))) throw new Error('Draft contains an invalid email address')
  if (!subject) throw new Error('Email subject is required')
  if (!text) throw new Error('Email body is required')
  if (/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/.test(`${subject}\n${html}`)) throw new Error('Resolve all template variables before sending')
  const assembled = await assembleManualEmail({ html, text, includeSignature: draft.include_signature })
  return {
    channel: 'email' as const,
    recipient: to,
    cc,
    bcc,
    subject,
    content: assembled.html ?? html,
    contentText: assembled.text ?? text,
    contentFormat: 'html' as const,
    documentIds: draft.document_ids ?? [],
    includeSignature: draft.include_signature,
    contextType: draft.context_type,
    contextId: draft.context_id,
    draftUpdatedAt: draft.updated_at,
  }
}

export async function sendStoredEmailDraft(
  admin: SupabaseClient,
  draft: StoredEmailDraft,
  actor: ActionActor,
) {
  const preview = await emailDraftPreview(draft)
  const attachments = preview.contextType === 'matter' && preview.contextId && preview.documentIds.length
    ? await loadMatterDocumentAttachments(admin, preview.contextId, preview.documentIds)
    : []
  if (attachments.length > MAX_ATTACHMENT_COUNT || totalAttachmentBytes(attachments) > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error('Draft attachments exceed the email limits')
  }
  const result = await sendEmail({
    category: 'manual',
    to: preview.recipient,
    cc: preview.cc.length ? preview.cc : undefined,
    bcc: preview.bcc.length ? preview.bcc : undefined,
    subject: preview.subject,
    html: preview.content,
    text: preview.contentText,
    useStoredTemplate: false,
    userId: actor.id,
    attachments: attachments.length ? attachments : undefined,
    // The exact signature shown in the approved preview is already assembled.
    includeSignature: false,
    matterId: preview.contextType === 'matter' ? preview.contextId : null,
    leadId: preview.contextType === 'lead' ? preview.contextId : null,
    contactId: preview.contextType === 'contact' ? preview.contextId : null,
  })
  if (!result.ok) throw new Error(result.error)

  const actorName = (actor.user_metadata?.full_name as string | undefined) ?? actor.email ?? null
  if (preview.contextType === 'matter' && preview.contextId) {
    await admin.from('matter_activity').insert({
      matter_id: preview.contextId,
      event_type: 'email_sent',
      actor_id: actor.id,
      actor_name: actorName,
      title: `Email sent: ${preview.subject}`,
      detail: `To ${preview.recipient} · ${result.status}`,
    })
  } else if (preview.contextType === 'lead' && preview.contextId) {
    await admin.from('lead_activity').insert({
      lead_id: preview.contextId,
      event_type: 'email_sent',
      actor_id: actor.id,
      title: `Email sent: ${preview.subject}`,
      detail: `To ${preview.recipient} · ${result.status}`,
    })
  }
  return { sent: true, status: result.status, draftId: draft.id, attachmentCount: attachments.length }
}
