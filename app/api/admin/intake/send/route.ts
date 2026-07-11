import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { createIntakeInviteToken } from '@/lib/intakeInviteTokens'
import { getAdminClient } from '@/lib/supabaseAdmin'

function resolveOrigin(req: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  if (process.env.SUPABASE_AUTH_SITE_URL) return process.env.SUPABASE_AUTH_SITE_URL.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(req.url).origin
}

export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  // Accepts either a matterId (matter-attached intake) or an intakeId
  // (standalone lead intake — the Leads page sends intake before a matter exists).
  const body = await req.json().catch(() => ({})) as { matterId?: string; intakeId?: string }
  const matterId = typeof body.matterId === 'string' ? body.matterId.trim() : ''
  const leadIntakeId = typeof body.intakeId === 'string' ? body.intakeId.trim() : ''
  if (!matterId && !leadIntakeId) {
    return NextResponse.json({ error: 'matterId or intakeId is required' }, { status: 400 })
  }

  const admin = getAdminClient()
  let intakeId = leadIntakeId
  if (matterId) {
    const { data: matter, error: matterError } = await admin
      .from('matters')
      .select('id, client_intake_id')
      .eq('id', matterId)
      .maybeSingle()

    if (matterError) {
      return NextResponse.json({ error: matterError.message }, { status: 500 })
    }
    if (!matter?.client_intake_id) {
      return NextResponse.json({ error: 'Matter not found or missing intake' }, { status: 404 })
    }
    intakeId = matter.client_intake_id
  }

  const { data: intakeRow, error: intakeFetchError } = await admin
    .from('client_intake')
    .select('id, email, first_name, last_name')
    .eq('id', intakeId)
    .maybeSingle()

  if (intakeFetchError) {
    return NextResponse.json({ error: intakeFetchError.message }, { status: 500 })
  }
  if (!intakeRow?.email) {
    return NextResponse.json({ error: 'Client has no email address on file' }, { status: 400 })
  }

  const invite = createIntakeInviteToken()
  const now = new Date().toISOString()

  const { error: intakeError } = await admin
    .from('client_intake')
    .update({
      intake_sent_at: now,
      intake_token_hash: invite.tokenHash,
      intake_token_expires_at: invite.expiresAt,
    })
    .eq('id', intakeId)

  if (intakeError) {
    return NextResponse.json({ error: intakeError.message }, { status: 500 })
  }

  const origin = resolveOrigin(req)
  const url = `${origin}/intake/auth?invite=${encodeURIComponent(invite.token)}`

  const firm = getFirmConfig()
  const firstName = (intakeRow.first_name as string | null) ?? 'there'
  const clientEmail = intakeRow.email as string

  const emailResult = await sendEmail({
    to: clientEmail,
    category: 'intake_invite',
    subject: `${firm.firmName} — complete your estate planning intake`,
    html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937;">
<p>Hi {{firstName}},</p>
<p>Please use the secure link below to create your portal password and complete your intake questionnaire.</p>
<p><a href="{{intakeUrl}}" style="color:#2a7d70;font-weight:600;">Start intake</a></p>
<p style="font-size:13px;color:#6b7280;">This link expires in 14 days. If it stops working, ask us to resend from your matter.</p>
<p>— {{attorneyShortName}}<br/>{{firmName}}</p>
</body></html>`,
    replyTo: firm.email,
    useStoredTemplate: true,
    templateVariables: {
      firstName,
      intakeUrl: url,
      firmName: firm.firmName,
      attorneyShortName: firm.attorneyShortName,
    },
  })

  if (matterId) {
    try {
      const actorName =
        (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null
      await admin.from('matter_activity').insert({
        matter_id: matterId,
        event_type: 'intake_sent',
        title: 'Intake sent',
        detail: url,
        actor_id: userId,
        actor_email: user?.email ?? null,
        actor_name: actorName,
      })
    } catch (e) {
      console.warn('matter_activity intake_sent skipped:', e)
    }
  }

  return NextResponse.json({
    url,
    intake_sent_at: now,
    email: emailResult.ok ? emailResult.status : 'error',
  })
}
