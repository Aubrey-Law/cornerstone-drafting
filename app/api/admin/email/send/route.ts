import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import {
  emailTemplateHtmlToText,
  sanitizeEmailHtml,
  textToEmailHtml,
} from '@/lib/email/templateShared'
import {
  formatBytes,
  loadMatterDocumentAttachments,
  totalAttachmentBytes,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type EmailAttachment,
} from '@/lib/email/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Payload {
  to?: unknown
  cc?: unknown
  subject?: unknown
  html?: unknown
  text?: unknown
  matterId?: unknown
  leadId?: unknown
  documentIds?: unknown
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * POST /api/admin/email/send
 *
 * The rail's compose pane. Accepts multipart/form-data so uploads from the
 * operator's computer ride along with the message; matter documents come by id
 * and are read from R2 here rather than round-tripping through the browser.
 *
 * The per-record routes (`/api/admin/{leads,matters}/[id]/send-email`) are
 * unchanged — this is the general path that also handles a send with no record
 * in context.
 */
export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const rl = await consumeRateLimit(
    { bucket: 'admin_email_send', limit: 30, windowSeconds: 600 },
    userId ?? 'anon',
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many emails sent — try again shortly', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let payload: Payload
  const uploads: EmailAttachment[] = []

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'Invalid form body' }, { status: 400 })
    try {
      payload = JSON.parse(String(form.get('payload') ?? '{}')) as Payload
    } catch {
      return NextResponse.json({ error: 'Invalid payload field' }, { status: 400 })
    }
    for (const entry of form.getAll('files')) {
      if (!(entry instanceof File) || entry.size === 0) continue
      uploads.push({
        filename: entry.name || 'attachment',
        content: Buffer.from(await entry.arrayBuffer()),
        contentType: entry.type || undefined,
      })
    }
  } else {
    payload = (await req.json().catch(() => ({}))) as Payload
  }

  const to = cleanString(payload.to)
  const subject = cleanString(payload.subject)
  const suppliedHtml = typeof payload.html === 'string' ? sanitizeEmailHtml(payload.html).trim() : ''
  const suppliedText = cleanString(payload.text)
  const text = suppliedText || emailTemplateHtmlToText(suppliedHtml)
  const html = suppliedHtml || textToEmailHtml(text)
  const cc = Array.isArray(payload.cc)
    ? payload.cc.filter((value): value is string => typeof value === 'string' && isEmail(value.trim()))
    : []

  if (!to || !isEmail(to)) {
    return NextResponse.json({ error: 'A valid recipient address is required' }, { status: 400 })
  }
  if (!subject) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 })

  const matterId = cleanString(payload.matterId) || null
  const leadId = cleanString(payload.leadId) || null
  const documentIds = Array.isArray(payload.documentIds)
    ? payload.documentIds.filter((value): value is string => typeof value === 'string')
    : []

  const admin = getAdminClient()

  let attachments = uploads
  try {
    if (matterId && documentIds.length > 0) {
      attachments = [...uploads, ...(await loadMatterDocumentAttachments(admin, matterId, documentIds))]
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read the selected documents' },
      { status: 500 },
    )
  }

  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    return NextResponse.json(
      { error: `At most ${MAX_ATTACHMENT_COUNT} attachments per email` },
      { status: 400 },
    )
  }
  const totalBytes = totalAttachmentBytes(attachments)
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return NextResponse.json(
      {
        error: `Attachments total ${formatBytes(totalBytes)} — the limit is ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}`,
      },
      { status: 413 },
    )
  }

  const result = await sendEmail({
    category: 'manual',
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    html,
    text,
    useStoredTemplate: false,
    userId,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  const attachmentNote = attachments.length
    ? ` · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
    : ''

  // Log to whichever record the pane was scoped to, matching what the
  // per-record send routes already write.
  if (matterId) {
    const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null
    const { error: activityError } = await admin.from('matter_activity').insert({
      matter_id: matterId,
      event_type: 'email_sent',
      actor_id: userId,
      actor_name: actorName,
      title: `Email sent: ${subject}`,
      detail: `To ${to} · ${result.status}${attachmentNote}`,
    })
    if (activityError) console.error('email send: failed to log matter activity', activityError)
  } else if (leadId) {
    const { error: activityError } = await admin.from('lead_activity').insert({
      lead_id: leadId,
      event_type: 'email_sent',
      actor_id: userId,
      title: `Email sent: ${subject}`,
      detail: `To ${to} · ${result.status}${attachmentNote}`,
    })
    if (activityError) console.error('email send: failed to log lead activity', activityError)
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    attachmentCount: attachments.length,
  })
}
