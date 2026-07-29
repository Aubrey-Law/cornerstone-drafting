import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email/send'

type Params = { params: Promise<{ id: string }> }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const text =
    typeof body.text === 'string'
      ? body.text
      : typeof body.body === 'string'
        ? body.body
        : typeof body.html === 'string'
          ? body.html.replace(/<[^>]+>/g, '')
          : ''
  const html =
    typeof body.html === 'string' && body.html.trim()
      ? body.html
      : `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`
  const replyTo =
    typeof body.replyTo === 'string' && body.replyTo.trim() ? body.replyTo.trim() : undefined

  if (!to || !EMAIL_RE.test(to) || !subject || !text.trim()) {
    return NextResponse.json({ error: 'to, subject, and body/text are required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id')
    .eq('id', matterId)
    .maybeSingle()

  if (matterError) {
    return NextResponse.json({ error: matterError.message }, { status: 500 })
  }
  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const result = await sendEmail({
    category: 'manual',
    to,
    subject,
    html,
    text,
    replyTo,
    useStoredTemplate: false,
    userId,
    includeSignature: body.includeSignature === true,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  const provider =
    result.status === 'sent' || result.status === 'redirected'
      ? 'resend'
      : result.status

  const actorName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null

  const { data: activity, error: activityError } = await admin
    .from('matter_activity')
    .insert({
      matter_id: matterId,
      event_type: 'email_sent',
      actor_id: userId,
      actor_email: user?.email ?? null,
      actor_name: actorName,
      title: `Email sent: ${subject}`,
      detail: `To ${to} · ${result.status}`,
      metadata: { to, subject, status: result.status, logId: result.logId },
    })
    .select()
    .single()

  if (activityError) {
    console.error('matter send-email: failed to log activity', activityError)
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    provider,
    logId: result.logId,
    activity: activity ?? null,
  })
}
