import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { isSmsConfigured } from '@/lib/communications/config'
import {
  resolveLeadSmsTarget,
  resolveMatterSmsTarget,
  sendOutboundSms,
} from '@/lib/sms/outbound'
import { notifyClientOfFirmMessage } from '@/lib/portalNotifications'
import { buildCalendlyLink, getCalendlyUrls } from '@/lib/calendly/links'
import { MEETING_TYPE_KEYS, meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Recipient {
  name: string
  firstName: string | null
  email: string | null
  phone: string | null
}

async function resolveRecipient(
  target: { leadId?: string | null; matterId?: string | null },
): Promise<{ recipient: Recipient | null; error: string | null }> {
  const admin = getAdminClient()
  if (target.leadId) {
    const { data, error } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, email, phone')
      .eq('id', target.leadId)
      .maybeSingle()
    if (error) return { recipient: null, error: error.message }
    if (!data) return { recipient: null, error: 'Lead not found' }
    const name =
      data.full_name?.trim() ||
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      'Lead'
    return {
      recipient: {
        name,
        firstName: data.first_name?.trim() || null,
        email: data.email?.trim()?.toLowerCase() || null,
        phone: data.phone || null,
      },
      error: null,
    }
  }
  const { data, error } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, client_name, client_email, client_phone')
    .eq('matter_id', target.matterId)
    .maybeSingle()
  if (error) return { recipient: null, error: error.message }
  if (!data) return { recipient: null, error: 'Matter not found' }
  const name = data.client_name?.trim() || 'Client'
  return {
    recipient: {
      name,
      firstName: name.split(' ')[0] || null,
      email: data.client_email?.trim()?.toLowerCase() || null,
      phone: data.client_phone || null,
    },
    error: null,
  }
}

function defaultMessage(firstName: string | null, label: string, link: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,'
  return `${greeting}\n\nPlease use this link to schedule your ${label}:\n${link}\n\nIf none of the times work, let us know and we'll find one that does.`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textToHtml(text: string, link: string): string {
  const escapedLink = escapeHtml(link)
  const escaped = escapeHtml(text)
  const linked = escaped.includes(escapedLink)
    ? escaped.replace(escapedLink, `<a href="${escapedLink}">${escapedLink}</a>`)
    : escaped
  return `<pre style="font-family:inherit;white-space:pre-wrap">${linked}</pre>`
}

// GET ?leadId=… | ?matterId=… → dialog data: recipient, channel availability,
// per-type per-channel links (utm_medium varies), and staff embed URL.
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const searchParams = new URL(req.url).searchParams
  const leadId = searchParams.get('leadId')
  const matterId = searchParams.get('matterId')
  if ((leadId && matterId) || (!leadId && !matterId)) {
    return NextResponse.json({ error: 'Pass exactly one of leadId or matterId' }, { status: 400 })
  }

  const { recipient, error } = await resolveRecipient({ leadId, matterId })
  if (error || !recipient) {
    return NextResponse.json({ error: error ?? 'Not found' }, { status: 404 })
  }

  const urls = await getCalendlyUrls()
  const linkOpts = {
    name: recipient.name,
    email: recipient.email,
    leadId,
    matterId,
  }
  const types = MEETING_TYPE_KEYS.map(key => {
    const meetingType = meetingTypeForKey(key)!
    const base = urls[key]
    return {
      key,
      label: meetingType.label,
      configured: Boolean(base),
      links: base
        ? {
            email: buildCalendlyLink(base, { ...linkOpts, channel: 'email' }),
            sms: buildCalendlyLink(base, { ...linkOpts, channel: 'sms' }),
            portal: buildCalendlyLink(base, { ...linkOpts, channel: 'portal' }),
          }
        : null,
      embedUrl: base ? buildCalendlyLink(base, { ...linkOpts, channel: 'staff' }) : null,
    }
  })

  return NextResponse.json({
    recipient: { name: recipient.name, email: recipient.email, phone: recipient.phone },
    smsConfigured: isSmsConfigured(),
    portalAvailable: Boolean(matterId),
    types,
  })
}

export async function POST(req: NextRequest) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const target = (body.target ?? {}) as { leadId?: unknown; matterId?: unknown }
  const leadId = typeof target.leadId === 'string' && target.leadId.trim() ? target.leadId.trim() : null
  const matterId = typeof target.matterId === 'string' && target.matterId.trim() ? target.matterId.trim() : null
  if ((leadId && matterId) || (!leadId && !matterId)) {
    return NextResponse.json({ error: 'Pass exactly one of target.leadId or target.matterId' }, { status: 400 })
  }

  const channel = body.channel
  if (channel !== 'email' && channel !== 'sms' && channel !== 'portal') {
    return NextResponse.json({ error: 'channel must be email, sms, or portal' }, { status: 400 })
  }
  if (channel === 'portal' && !matterId) {
    return NextResponse.json({ error: 'Portal messages require a matter target' }, { status: 400 })
  }

  const meetingType = meetingTypeForKey(typeof body.meetingTypeKey === 'string' ? body.meetingTypeKey : null)
  if (!meetingType) {
    return NextResponse.json({ error: 'Unknown meeting type' }, { status: 400 })
  }

  const urls = await getCalendlyUrls()
  const baseUrl = urls[meetingType.key as MeetingTypeKey]
  if (!baseUrl) {
    return NextResponse.json(
      { error: `No Calendly link configured for ${meetingType.label}. Add it in Settings → Scheduling.` },
      { status: 400 },
    )
  }

  const { recipient, error: recipientError } = await resolveRecipient({ leadId, matterId })
  if (recipientError || !recipient) {
    return NextResponse.json({ error: recipientError ?? 'Not found' }, { status: 404 })
  }

  const link = buildCalendlyLink(baseUrl, {
    name: recipient.name,
    email: recipient.email,
    leadId,
    matterId,
    channel,
  })

  const provided = typeof body.message === 'string' ? body.message.trim() : ''
  // Any link to the same booking page counts — the user may have kept a
  // variant with different utm params from the dialog preview.
  const hasLink = provided.includes(baseUrl)
  const message = provided
    ? hasLink ? provided : `${provided}\n\n${link}`
    : defaultMessage(recipient.firstName, meetingType.label, link)

  const admin = getAdminClient()
  const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null

  if (channel === 'email') {
    if (!recipient.email) {
      return NextResponse.json({ error: `${recipient.name} has no email address on file.` }, { status: 400 })
    }
    const subject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : `Schedule your ${meetingType.label}`
    const result = await sendEmail({
      category: 'scheduling_link',
      to: recipient.email,
      subject,
      text: message,
      html: textToHtml(message, link),
      useStoredTemplate: false,
      userId,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }
    if (leadId) {
      await admin
        .from('lead_activity')
        .insert({
          lead_id: leadId,
          event_type: 'email_sent',
          title: `Scheduling link sent: ${meetingType.label}`,
          detail: `To ${recipient.email} · ${result.status}`,
          actor_id: userId,
        })
        .select()
        .single()
    } else {
      await admin
        .from('matter_activity')
        .insert({
          matter_id: matterId,
          event_type: 'email_sent',
          actor_id: userId,
          actor_email: user?.email ?? null,
          actor_name: actorName,
          title: `Scheduling link sent: ${meetingType.label}`,
          detail: `To ${recipient.email} · ${result.status}`,
          metadata: { to: recipient.email, subject, status: result.status, logId: result.logId },
        })
        .select()
        .single()
    }
    return NextResponse.json({ success: true, channel, status: result.status })
  }

  if (channel === 'sms') {
    if (!isSmsConfigured()) {
      return NextResponse.json({ error: 'SMS is not configured' }, { status: 503 })
    }
    const { target: smsTarget, error: targetError } = leadId
      ? await resolveLeadSmsTarget(leadId)
      : await resolveMatterSmsTarget(matterId!, 'client')
    if (targetError || !smsTarget) {
      return NextResponse.json({ error: targetError ?? 'Recipient not found' }, { status: 404 })
    }
    const result = await sendOutboundSms(smsTarget, message, {
      id: userId!,
      email: user?.email ?? null,
      name: actorName,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 502 })
    }
    return NextResponse.json({ success: true, channel, status: result.status })
  }

  // channel === 'portal' (matterId guaranteed above)
  const { error: messageError } = await admin
    .from('messages')
    .insert({
      matter_id: matterId,
      sender_role: 'attorney',
      sender_id: userId,
      body: message,
    })
    .select()
    .single()
  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 })
  }
  await notifyClientOfFirmMessage(matterId!)
  return NextResponse.json({ success: true, channel, status: 'posted' })
}
