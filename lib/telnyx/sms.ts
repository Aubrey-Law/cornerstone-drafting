import { getTelnyxClient } from '@/lib/telnyx/client'
import { telnyxAppBaseUrl, telnyxPhoneNumber } from '@/lib/telnyx/config'
import type { SmsSendInput, SmsSendResult } from '@/lib/sms/transport'

export async function sendTelnyxSmsMessage(input: SmsSendInput): Promise<SmsSendResult> {
  const from = telnyxPhoneNumber()
  if (!from) return { ok: false, error: 'Telnyx SMS is not configured.' }
  try {
    const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID?.trim()
    const result = await getTelnyxClient().messages.send({
      from,
      to: input.to,
      text: input.body,
      ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
      webhook_url: `${telnyxAppBaseUrl()}/api/webhooks/telnyx/messaging`,
      use_profile_webhooks: true,
      type: 'SMS',
    })
    if (!result.data?.id) return { ok: false, error: 'Telnyx did not return a message id.' }
    return {
      ok: true,
      providerMessageId: result.data.id,
      status: result.data.to?.[0]?.status ?? 'queued',
      to: input.to,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'SMS send failed.' }
  }
}
