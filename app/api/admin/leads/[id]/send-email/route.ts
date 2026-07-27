import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email/send'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  emailTemplateHtmlToText,
  sanitizeEmailHtml,
  textToEmailHtml,
} from '@/lib/email/templateShared'

type Params = { params: Promise<{ id: string }> }


type Params = { params: Promise<{ id: string }> }

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { id } = await params
  const body = await req.json().catch(() => null) as {
    subject?: unknown
    text?: unknown
    html?: unknown
  } | null
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const suppliedHtml = typeof body?.html === 'string' ? sanitizeEmailHtml(body.html).trim() : ''
  const suppliedText = typeof body?.text === 'string' ? body.text.trim() : ''
  const text = suppliedText || emailTemplateHtmlToText(suppliedHtml)
  const html = suppliedHtml || textToEmailHtml(text)
  const body = await req.json().catch(() => null) as { subject?: unknown; text?: unknown } | null
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!subject || !text) {
    return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, email')
    .eq('id', id)
    .not('lead_status', 'is', null)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const to = lead.email?.trim()
  if (!to) return NextResponse.json({ error: 'This lead does not have an email address' }, { status: 400 })

  const result = await sendEmail({
    category: 'manual',
    to,
    subject,
    text,
    html,
    html: `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`,
    useStoredTemplate: false,
    userId,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  const { data: activity, error: activityError } = await admin.from('lead_activity').insert({
    lead_id: id,
    event_type: 'email_sent',
    actor_id: userId,
    title: `Email sent: ${subject}`,
    detail: `To ${to} · ${result.status}`,
  }).select().single()
  if (activityError) console.error('lead send-email: failed to log activity', activityError)

  return NextResponse.json({ success: true, status: result.status, activity: activity ?? null })
}
