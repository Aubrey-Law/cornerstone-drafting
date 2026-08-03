import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { ensureStandingIntakeLink } from '@/lib/intake/standingLinks'
import { getAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  // Accepts either a matterId or an intakeId, and the matter may be a lead —
  // sending the intake is one of the things you do before anyone is hired.
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

  const now = new Date().toISOString()
  const link = await ensureStandingIntakeLink(admin, intakeId)

  const { error: intakeError } = await admin
    .from('client_intake')
    .update({
      intake_sent_at: now,
    })
    .eq('id', intakeId)

  if (intakeError) {
    return NextResponse.json({ error: intakeError.message }, { status: 500 })
  }

  const url = link.url
  if (!url) {
    return NextResponse.json({ error: 'Could not prepare intake link' }, { status: 500 })
  }

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
<p style="font-size:13px;color:#6b7280;">You may return to this link until our office revokes or replaces it.</p>
<p>— {{attorneyShortName}}<br/>{{firmName}}</p>
</body></html>`,
    replyTo: firm.email,
    useStoredTemplate: true,
    templateVariables: {
      firstName,
      first_name: firstName,
      client_name: [intakeRow.first_name, intakeRow.last_name].filter(Boolean).join(' '),
      intakeUrl: url,
      intake_link: url,
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
