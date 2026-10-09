import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { isSmsConfigured } from '@/lib/communications/config'
import { notifyClientOfFirmMessage } from '@/lib/portalNotifications'
import { listAppointmentTypes } from '@/lib/appointments/settings'
import type { AppointmentType } from '@/lib/appointments/types'
import { loadBookingAttendee } from '@/lib/appointments/bookingAttendee'
import { nativeBookingPath, nativeBookingUrl, type BookingPrefill } from '@/lib/bookings/prefill'

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

/** Stored first/last names when the record has them; the display name otherwise. */
async function bookingPrefill(
  target: { leadId: string | null; matterId: string | null },
  recipient: Recipient,
): Promise<BookingPrefill> {
  const attendee = await loadBookingAttendee(
    getAdminClient(),
    target.leadId ? { leadId: target.leadId } : { matterId: target.matterId! },
  ).catch(() => null)
  return {
    firstName: attendee?.firstName ?? recipient.firstName,
    lastName: attendee?.lastName ?? null,
    email: recipient.email,
    phone: recipient.phone,
  }
}

async function findBookableType(slug: unknown): Promise<AppointmentType | null> {
  if (typeof slug !== 'string' || !slug) return null
  return (await listAppointmentTypes()).find(type => type.slug === slug && type.active) ?? null
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

  const prefill = await bookingPrefill({ leadId, matterId }, recipient)
  // The firm's own booking pages. A portal-only type needs a signed-in
  // client, so it is offered for portal messages only.
  const types = (await listAppointmentTypes())
    .filter(type => type.active)
    .map(type => {
      const url = nativeBookingUrl(type.slug, prefill)
      return {
        key: type.slug,
        label: type.label,
        configured: type.public || Boolean(matterId),
        portalOnly: !type.public,
        links: { email: url, sms: url, portal: url },
        // Embedded in the staff app: same host, so the page can report back.
        embedUrl: nativeBookingPath(type.slug, prefill),
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
  if (channel === 'sms') return NextResponse.json({ error: 'Texting has been retired.' }, { status: 410 })
  if (channel === 'portal' && !matterId) {
    return NextResponse.json({ error: 'Portal messages require a matter target' }, { status: 400 })
  }

  const meetingType = await findBookableType(body.meetingTypeKey)
  if (!meetingType) {
    return NextResponse.json({ error: 'Unknown appointment type' }, { status: 400 })
  }
  if (!meetingType.public && channel !== 'portal') {
    return NextResponse.json(
      { error: `${meetingType.label} is booked from the client portal; send it as a portal message.` },
      { status: 400 },
    )
  }
  const baseUrl = nativeBookingUrl(meetingType.slug)

  const { recipient, error: recipientError } = await resolveRecipient({ leadId, matterId })
  if (recipientError || !recipient) {
    return NextResponse.json({ error: recipientError ?? 'Not found' }, { status: 404 })
  }

  const link = nativeBookingUrl(meetingType.slug, await bookingPrefill({ leadId, matterId }, recipient))

  const provided = typeof body.message === 'string' ? body.message.trim() : ''
  // Any link to the same booking page counts, prefilled or not.
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
