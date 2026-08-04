import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { emailTemplateHtmlToText, sanitizeEmailHtml, textToEmailHtml } from '@/lib/email/templateShared'
import { getAdminClient } from '@/lib/supabaseAdmin'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UNRESOLVED_RE = /\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/
const MAX_FUTURE_MS = 366 * 24 * 60 * 60_000

type ContextType = 'matter' | 'lead' | 'contact' | 'general'

const CONTEXT_TYPES: string[] = ['matter', 'lead', 'contact', 'general']

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : []
}

function responseItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    contextType: row.context_type,
    contextId: row.context_id,
    to: row.to_email,
    subject: row.subject,
    scheduledFor: row.scheduled_for,
    timezone: row.timezone,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const contextType = url.searchParams.get('contextType')
  const contextId = url.searchParams.get('contextId')?.trim() || null

  let query = getAdminClient()
    .from('scheduled_emails')
    .select('id, context_type, context_id, to_email, subject, scheduled_for, timezone, status, attempts, last_error, created_at')
    .eq('user_id', userId)
    .order('scheduled_for', { ascending: false })
    .limit(50)
  if (contextType && CONTEXT_TYPES.includes(contextType)) {
    query = query.eq('context_type', contextType)
    query = contextId ? query.eq('context_id', contextId) : query.is('context_id', null)
  }
  const { data, error } = await query
  if (error) {
    if (error.message.includes('scheduled_emails')) {
      return NextResponse.json({ scheduled: [], migrationRequired: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ scheduled: (data ?? []).map(row => responseItem(row as Record<string, unknown>)) })
}

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const contextType = body.contextType as ContextType
  const contextId = typeof body.contextId === 'string' && body.contextId.trim() ? body.contextId.trim() : null
  if (!CONTEXT_TYPES.includes(contextType)) {
    return NextResponse.json({ error: 'Invalid context type' }, { status: 400 })
  }
  if ((contextType === 'general' && contextId) || (contextType !== 'general' && !contextId)) {
    return NextResponse.json({ error: 'Invalid schedule context' }, { status: 400 })
  }

  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const cc = stringList(body.cc)
  const bcc = stringList(body.bcc)
  if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'A valid recipient is required' }, { status: 400 })
  const invalidCopies = [...cc, ...bcc].filter(address => !EMAIL_RE.test(address))
  if (invalidCopies.length) {
    return NextResponse.json({ error: `Invalid CC/BCC address: ${invalidCopies.join(', ')}` }, { status: 400 })
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const suppliedHtml = typeof body.html === 'string' ? sanitizeEmailHtml(body.html).trim() : ''
  const suppliedText = typeof body.text === 'string' ? body.text.trim() : ''
  const text = suppliedText || emailTemplateHtmlToText(suppliedHtml)
  const html = suppliedHtml || textToEmailHtml(text)
  if (!subject || !text) return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
  if (UNRESOLVED_RE.test(`${subject}\n${html}`)) {
    return NextResponse.json({ error: 'Resolve or remove all template variables before scheduling' }, { status: 400 })
  }

  const scheduledFor = typeof body.scheduledFor === 'string' ? new Date(body.scheduledFor) : new Date(Number.NaN)
  const now = Date.now()
  if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() < now + 30_000) {
    return NextResponse.json({ error: 'Choose a future send time' }, { status: 400 })
  }
  if (scheduledFor.getTime() > now + MAX_FUTURE_MS) {
    return NextResponse.json({ error: 'Scheduled time must be within one year' }, { status: 400 })
  }
  const timezone =
    typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim().slice(0, 100) : 'America/New_York'
  const documentIds = contextType === 'matter' ? stringList(body.documentIds).slice(0, 25) : []

  const { data, error } = await getAdminClient()
    .from('scheduled_emails')
    .insert({
      user_id: userId,
      context_type: contextType,
      context_id: contextId,
      to_email: to,
      cc,
      bcc,
      subject,
      body_html: html,
      body_text: text,
      document_ids: documentIds,
      include_signature: body.includeSignature === true,
      scheduled_for: scheduledFor.toISOString(),
      timezone,
      next_attempt_at: scheduledFor.toISOString(),
      status: 'pending',
    })
    .select('id, context_type, context_id, to_email, subject, scheduled_for, timezone, status, attempts, last_error, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled: responseItem(data as Record<string, unknown>) }, { status: 201 })
}

