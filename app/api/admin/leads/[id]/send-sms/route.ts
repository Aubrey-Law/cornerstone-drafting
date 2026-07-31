import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isSmsConfigured } from '@/lib/communications/config'
import { smsProvider } from '@/lib/communications/providers'
import { MAX_LEAD_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { normalizeSmsRecipient, sendProviderSmsMessage } from '@/lib/sms/provider'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { telnyxPhoneNumber } from '@/lib/telnyx/config'

type Params = { params: Promise<{ id: string }> }

function senderNumber() {
  if (smsProvider() === 'telnyx') return telnyxPhoneNumber()
  return process.env.TWILIO_SMS_FROM?.trim() || process.env.TWILIO_CALLER_ID?.trim() || null
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err
  if (!isSmsConfigured()) {
    return NextResponse.json({ error: 'The selected SMS provider is not configured.' }, { status: 503 })
  }
  const { id } = await params
  const payload = await req.json().catch(() => null) as { body?: unknown } | null
  const message = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  if (message.length > MAX_LEAD_SMS_BODY_LENGTH) {
    return NextResponse.json({ error: `Message must be ${MAX_LEAD_SMS_BODY_LENGTH} characters or fewer` }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, first_name, last_name, full_name, phone, matter_id')
    .eq('id', id)
    .not('lead_status', 'is', null)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const to = normalizeSmsRecipient(lead.phone)
  if (!to) return NextResponse.json({ error: 'This lead does not have a textable US phone number' }, { status: 400 })

  const name = lead.full_name?.trim()
    || [lead.first_name, lead.last_name].filter(Boolean).join(' ')
    || 'Client'
  const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null
  const baseRow = {
    matter_id: lead.matter_id ?? null,
    lead_id: id,
    direction: 'outbound',
    provider: smsProvider(),
    recipient_role: 'client',
    recipient_name: name,
    to_number: to,
    from_number: senderNumber(),
    body: message,
    status: 'pending',
    actor_id: userId,
    actor_email: user?.email ?? null,
    actor_name: actorName,
    raw_payload: { lead_id: id, requested_phone: lead.phone },
  }
  const { data: smsRow, error: insertError } = await admin.from('sms_messages').insert(baseRow).select().single()
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const result = await sendProviderSmsMessage({ to, body: message })
  const update = result.ok
    ? { status: result.status, provider_message_id: result.providerMessageId, sent_at: new Date().toISOString(), error: null }
    : { status: 'failed', error: result.error }
  const { data: updated } = await admin.from('sms_messages').update(update).eq('id', smsRow.id).select().single()
  const title = result.ok ? `Text sent to ${name}` : `Text failed to ${name}`
  const { data: activity, error: activityError } = await admin.from('lead_activity').insert({
    lead_id: id,
    event_type: 'sms_sent',
    actor_id: userId,
    title,
    detail: `To ${to}${result.ok ? '' : ` · ${result.error}`}`,
  }).select().single()
  if (activityError) console.error('lead send-sms: failed to log activity', activityError)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, smsMessage: updated ?? smsRow, activity }, { status: 502 })
  }
  return NextResponse.json({ success: true, status: result.status, smsMessage: updated ?? smsRow, activity })
}
