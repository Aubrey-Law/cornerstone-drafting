import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  loadMatterDocumentAttachments,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  totalAttachmentBytes,
} from './attachments'
import { sendEmail } from './send'

interface ScheduledEmailRow {
  id: string
  user_id: string
  context_type: 'matter' | 'lead' | 'general'
  context_id: string | null
  to_email: string
  cc: string[]
  bcc: string[]
  subject: string
  body_html: string
  body_text: string
  document_ids: string[]
  include_signature: boolean
  scheduled_for: string
  attempts: number
}

const MAX_ATTEMPTS = 3
const BATCH_SIZE = 25

async function logRecordActivity(row: ScheduledEmailRow, status: string) {
  if (!row.context_id) return
  const admin = getAdminClient()
  const payload = {
    event_type: 'email_sent',
    actor_id: row.user_id,
    title: `Scheduled email ${status}: ${row.subject}`,
    detail: `To ${row.to_email} · ${status}`,
  }
  if (row.context_type === 'matter') {
    await admin.from('matter_activity').insert({ matter_id: row.context_id, ...payload })
  } else if (row.context_type === 'lead') {
    await admin.from('lead_activity').insert({ lead_id: row.context_id, ...payload })
  }
}

async function processClaimed(row: ScheduledEmailRow): Promise<'sent' | 'suppressed' | 'retrying' | 'failed'> {
  const admin = getAdminClient()
  const attempts = row.attempts + 1
  try {
    const attachments =
      row.context_type === 'matter' && row.context_id && row.document_ids.length > 0
        ? await loadMatterDocumentAttachments(admin, row.context_id, row.document_ids)
        : []
    if (attachments.length > MAX_ATTACHMENT_COUNT || totalAttachmentBytes(attachments) > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('Scheduled attachments exceed the current email limits')
    }

    const result = await sendEmail({
      category: 'manual',
      to: row.to_email,
      cc: row.cc.length ? row.cc : undefined,
      bcc: row.bcc.length ? row.bcc : undefined,
      subject: row.subject,
      html: row.body_html,
      text: row.body_text,
      useStoredTemplate: false,
      includeSignature: row.include_signature,
      userId: row.user_id,
      attachments: attachments.length ? attachments : undefined,
    })

    if (!result.ok) throw new Error(result.error)
    const completedStatus = result.status === 'sent' || result.status === 'redirected' ? 'sent' : 'suppressed'
    await admin
      .from('scheduled_emails')
      .update({
        status: completedStatus,
        attempts,
        provider_status: result.status,
        email_log_id: result.logId,
        sent_at: new Date().toISOString(),
        processing_started_at: null,
        last_error: completedStatus === 'suppressed' ? ('reason' in result ? result.reason : result.status) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing')
    if (completedStatus === 'sent') {
      await logRecordActivity(row, completedStatus)
    }
    return completedStatus
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled email failed'
    const failed = attempts >= MAX_ATTEMPTS
    const retryAt = new Date(Date.now() + attempts * 5 * 60_000).toISOString()
    await admin
      .from('scheduled_emails')
      .update({
        status: failed ? 'failed' : 'pending',
        attempts,
        next_attempt_at: retryAt,
        processing_started_at: null,
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing')
    return failed ? 'failed' : 'retrying'
  }
}

export async function processDueScheduledEmails(now = new Date()) {
  const admin = getAdminClient()
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - 15 * 60_000).toISOString()

  await admin
    .from('scheduled_emails')
    .update({
      status: 'pending',
      processing_started_at: null,
      next_attempt_at: nowIso,
      updated_at: nowIso,
      last_error: 'Recovered stale processing claim',
    })
    .eq('status', 'processing')
    .lt('processing_started_at', staleIso)

  const { data, error } = await admin
    .from('scheduled_emails')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .lte('next_attempt_at', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) throw new Error(error.message)

  const summary = { claimed: 0, sent: 0, suppressed: 0, retrying: 0, failed: 0 }
  for (const candidate of (data ?? []) as ScheduledEmailRow[]) {
    const { data: claimed, error: claimError } = await admin
      .from('scheduled_emails')
      .update({ status: 'processing', processing_started_at: nowIso, updated_at: nowIso })
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()
    if (claimError || !claimed) continue
    summary.claimed += 1
    const outcome = await processClaimed(claimed as ScheduledEmailRow)
    summary[outcome] += 1
  }
  return summary
}
