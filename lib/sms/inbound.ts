import { getAdminClient } from '@/lib/supabaseAdmin'
import { getFirmConfig } from '@/lib/firmConfig'

const SMS_OPT_OUT_PATTERN = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i

export function isSmsOptOutMessage(body: string): boolean {
  return SMS_OPT_OUT_PATTERN.test(body.trim())
}

export interface InboundSmsInput {
  fromNumber: string
  toNumber: string
  body: string
  providerMessageId: string
  rawPayload: Record<string, unknown>
}

export interface InboundSmsResult {
  ok: true
  smsMessageId: string
  duplicate: boolean
  optedOut: boolean
  matterId: string | null
}

export interface InboundSmsFailure {
  ok: false
  error: string
}

async function logInboundActivity(row: {
  id: string
  body: string
  from_number: string
  matter_id: string | null
  recipient_name: string | null
}): Promise<void> {
  if (!row.matter_id) return

  const admin = getAdminClient()
  const from = row.from_number
  const senderLabel = row.recipient_name?.trim() || from

  await admin.from('matter_activity').insert({
    matter_id: row.matter_id,
    event_type: 'sms_received',
    actor_id: null,
    actor_email: null,
    actor_name: senderLabel,
    title: `Text received from ${senderLabel}`,
    detail: from,
    metadata: {
      sms_message_id: row.id,
      from,
      body: row.body,
    },
  })
}

export async function recordInboundSms(
  input: InboundSmsInput,
): Promise<InboundSmsResult | InboundSmsFailure> {
  const body = input.body.trim()
  if (!body) {
    return { ok: false, error: 'empty body' }
  }
  if (!input.providerMessageId) {
    return { ok: false, error: 'missing MessageSid' }
  }

  const admin = getAdminClient()
  const optedOut = isSmsOptOutMessage(body)

  const { data: existing } = await admin
    .from('sms_messages')
    .select('id, matter_id')
    .eq('provider_message_id', input.providerMessageId)
    .maybeSingle()

  if (existing) {
    return {
      ok: true,
      smsMessageId: existing.id,
      duplicate: true,
      optedOut,
      matterId: existing.matter_id,
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from('sms_messages')
    .insert({
      direction: 'inbound',
      provider: 'twilio',
      provider_message_id: input.providerMessageId,
      recipient_role: 'other',
      from_number: input.fromNumber,
      to_number: input.toNumber,
      body,
      status: optedOut ? 'opt_out' : 'received',
      raw_payload: input.rawPayload,
      sent_at: new Date().toISOString(),
    })
    .select('id, body, from_number, matter_id, recipient_name')
    .single()

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? 'insert failed' }
  }

  if (!optedOut) {
    await logInboundActivity(inserted)
  }

  return {
    ok: true,
    smsMessageId: inserted.id,
    duplicate: false,
    optedOut,
    matterId: inserted.matter_id,
  }
}

export function twilioInboundSmsResponse(message?: string): Response {
  const escaped = message
    ? message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : null
  const xml = escaped
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export function smsOptOutConfirmation(): string {
  const firm = getFirmConfig()
  return `You have been unsubscribed from ${firm.firmName} text messages. Reply START to resubscribe.`
}
