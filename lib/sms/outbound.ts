import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizeSmsRecipient, sendSmsMessage } from '@/lib/twilio/sms'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

export { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

export type SmsRecipientRole = 'client' | 'spouse' | 'other'

export interface SmsActor {
  id: string
  email: string | null
  name: string | null
}

export interface ResolvedSmsTarget {
  recipientName: string
  recipientRole: SmsRecipientRole
  phone: string | null
  matterId: string
}

export interface OutboundSmsResult {
  ok: true
  status: string
  providerMessageId: string
  smsMessage: Record<string, unknown>
  activity: Record<string, unknown> | null
}

export interface OutboundSmsFailure {
  ok: false
  error: string
  smsMessage?: Record<string, unknown>
  activity?: Record<string, unknown> | null
  status?: number
}

function publicSenderNumber(): string | null {
  return (
    process.env.TWILIO_SMS_FROM?.trim() ||
    process.env.TWILIO_CALLER_ID?.trim() ||
    null
  )
}

export async function resolveMatterSmsTarget(
  matterId: string,
  recipient: 'client' | 'spouse',
): Promise<{ target: ResolvedSmsTarget | null; error: string | null }> {
  const admin = getAdminClient()
  const { data: matter, error } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, client_name, client_phone, spouse_name, spouse_phone')
    .eq('matter_id', matterId)
    .maybeSingle()

  if (error) return { target: null, error: error.message }
  if (!matter) return { target: null, error: 'Matter not found' }

  if (recipient === 'spouse') {
    return {
      target: {
        recipientName: matter.spouse_name?.trim() || 'Spouse',
        recipientRole: 'spouse',
        phone: matter.spouse_phone,
        matterId,
      },
      error: null,
    }
  }

  return {
    target: {
      recipientName: matter.client_name?.trim() || 'Client',
      recipientRole: 'client',
      phone: matter.client_phone,
      matterId,
    },
    error: null,
  }
}

export async function sendOutboundSms(
  target: ResolvedSmsTarget,
  body: string,
  actor: SmsActor,
): Promise<OutboundSmsResult | OutboundSmsFailure> {
  const trimmedBody = body.trim()
  if (!trimmedBody) {
    return { ok: false, error: 'body is required', status: 400 }
  }
  if (trimmedBody.length > MAX_SMS_BODY_LENGTH) {
    return {
      ok: false,
      error: `body must be ${MAX_SMS_BODY_LENGTH} characters or fewer`,
      status: 400,
    }
  }

  const to = normalizeSmsRecipient(target.phone)
  if (!to) {
    return {
      ok: false,
      error: `${target.recipientName} does not have a textable US phone number.`,
      status: 400,
    }
  }

  const admin = getAdminClient()
  const baseRow = {
    matter_id: target.matterId,
    direction: 'outbound',
    provider: 'twilio',
    recipient_role: target.recipientRole,
    recipient_name: target.recipientName,
    to_number: to,
    from_number: publicSenderNumber(),
    body: trimmedBody,
    status: 'pending',
    actor_id: actor.id,
    actor_email: actor.email,
    actor_name: actor.name,
    raw_payload: {
      requested_recipient: target.recipientRole,
      requested_phone: target.phone,
    },
  }

  const { data: smsRow, error: insertError } = await admin
    .from('sms_messages')
    .insert(baseRow)
    .select()
    .single()

  if (insertError) {
    return { ok: false, error: insertError.message, status: 500 }
  }

  const result = await sendSmsMessage({ to, body: trimmedBody })
  const nextStatus = result.ok ? result.status : 'failed'

  const updatePayload = result.ok
    ? {
        status: nextStatus,
        provider_message_id: result.providerMessageId,
        sent_at: new Date().toISOString(),
        error: null,
        raw_payload: {
          ...baseRow.raw_payload,
          twilio: {
            sid: result.providerMessageId,
            status: result.status,
          },
        },
      }
    : {
        status: nextStatus,
        error: result.error,
        raw_payload: {
          ...baseRow.raw_payload,
          error: result.error,
        },
      }

  const { data: updatedSmsRow } = await admin
    .from('sms_messages')
    .update(updatePayload)
    .eq('id', smsRow.id)
    .select()
    .single()

  const smsRecord = (updatedSmsRow ?? smsRow) as Record<string, unknown>
  let activity: Record<string, unknown> | null = null

  const title = result.ok
    ? `Text sent to ${target.recipientName}`
    : `Text failed to ${target.recipientName}`
  const detail = `To ${to}${result.ok ? '' : ` (${result.error})`}`

  const { data: matterActivity, error: activityError } = await admin
    .from('matter_activity')
    .insert({
      matter_id: target.matterId,
      event_type: 'sms_sent',
      actor_id: actor.id,
      actor_email: actor.email,
      actor_name: actor.name,
      title,
      detail,
      metadata: {
        sms_message_id: smsRow.id,
        recipient: target.recipientRole,
        to,
        status: nextStatus,
        provider_message_id: result.ok ? result.providerMessageId : undefined,
        error: result.ok ? undefined : result.error,
      },
    })
    .select()
    .single()

  if (activityError) {
    console.error('sendOutboundSms: failed to log matter activity', activityError)
  } else {
    activity = matterActivity as Record<string, unknown>
  }

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      smsMessage: smsRecord,
      activity,
      status: 502,
    }
  }

  return {
    ok: true,
    status: result.status,
    providerMessageId: result.providerMessageId,
    smsMessage: smsRecord,
    activity,
  }
}
