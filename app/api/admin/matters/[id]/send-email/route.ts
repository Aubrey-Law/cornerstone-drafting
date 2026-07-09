import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email/send'
import { GraphSendError, sendViaGraph } from '@/lib/email/graphSend'
import { getMicrosoftConnectionForUser } from '@/lib/microsoftCalendar'

type Params = { params: Promise<{ id: string }> }

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

  if (!to || !subject || !text.trim()) {
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

  let provider: 'graph' | 'resend' = 'resend'
  let status = 'sent'

  const conn = await getMicrosoftConnectionForUser(userId)
  if (conn) {
    try {
      await sendViaGraph({ to, subject, text, replyTo, userId })
      provider = 'graph'
    } catch (e) {
      if (!(e instanceof GraphSendError) || e.kind !== 'no_connection') {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Graph send failed' },
          { status: 502 },
        )
      }
      // no_connection → fall through to Resend
    }
  }

  if (provider !== 'graph') {
    const result = await sendEmail({
      category: 'manual',
      to,
      subject,
      html,
      replyTo,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }
    status = result.status
    provider = 'resend'
  }

  await admin.from('email_log').insert({
    category: 'manual',
    status,
    intended_to: to,
    actual_to: to,
    subject,
    matter_id: matterId,
    actor_id: userId,
  })

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
      detail: `To ${to} via ${provider}`,
      metadata: { to, subject, status, provider },
    })
    .select()
    .single()

  if (activityError) {
    console.error('matter send-email: failed to log activity', activityError)
  }

  return NextResponse.json({
    success: true,
    status,
    provider,
    activity: activity ?? null,
  })
}
