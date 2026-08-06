import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { suppressCampaignDeliveryByToken } from '@/lib/crm/campaignDispatch'
import { mapMailgunEvent } from '@/lib/crm/campaignPolicy'
import { unsubscribeTokenHash } from '@/lib/crm/mailgunCampaigns'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MailgunPayload = {
  signature?: { timestamp?: string; token?: string; signature?: string }
  'event-data'?: {
    id?: string
    event?: string
    'user-variables'?: Record<string, string | undefined>
  }
}

function hasValidSignature(payload: MailgunPayload): boolean {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY
  const signature = payload.signature
  if (!signingKey || !signature?.timestamp || !signature.token || !signature.signature) return false
  const timestamp = Number(signature.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 15 * 60) return false
  const expected = crypto.createHmac('sha256', signingKey)
    .update(`${signature.timestamp}${signature.token}`)
    .digest('hex')
  const received = signature.signature
  return received.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null) as MailgunPayload | null
  if (!payload || !hasValidSignature(payload)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const eventData = payload['event-data']
  const providerEventId = eventData?.id
  const eventType = eventData?.event
  if (!providerEventId || !eventType) return NextResponse.json({ error: 'Invalid event payload' }, { status: 400 })

  const admin = getAdminClient()
  const { data: event, error: eventError } = await admin
    .from('cornerstone_crm_campaign_events')
    .insert({
      provider_event_id: providerEventId,
      event_type: eventType,
      payload: payload as unknown as Record<string, unknown>,
    })
    .select('id')
    .maybeSingle()
  if (eventError) {
    if (eventError.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
    return NextResponse.json({ error: eventError.message }, { status: 500 })
  }
  if (!event) return NextResponse.json({ ok: true, duplicate: true })

  const token = eventData['user-variables']?.crm_delivery_token
  if (!token) return NextResponse.json({ ok: true, correlated: false })
  const { data: delivery } = await admin
    .from('cornerstone_crm_campaign_deliveries')
    .select('id')
    .eq('delivery_token_hash', unsubscribeTokenHash(token))
    .maybeSingle()
  if (!delivery) return NextResponse.json({ ok: true, correlated: false })

  await admin.from('cornerstone_crm_campaign_events').update({ delivery_id: delivery.id }).eq('id', event.id)
  const status = mapMailgunEvent(eventType)
  if (status === 'bounced' || status === 'complaint' || status === 'unsubscribed') {
    await suppressCampaignDeliveryByToken(token, status)
  } else {
    await admin.from('cornerstone_crm_campaign_deliveries').update({
      provider_status: status,
      last_event_at: new Date().toISOString(),
    }).eq('id', delivery.id)
  }

  return NextResponse.json({ ok: true, correlated: true })
}
