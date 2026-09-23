import { smsProvider } from '@/lib/communications/providers'
import { sendTelnyxSmsMessage } from '@/lib/telnyx/sms'
import { normalizeSmsRecipient, type SmsSendInput, type SmsSendResult } from '@/lib/sms/transport'

export { normalizeSmsRecipient }

/**
 * Telnyx is the only delivery path. Twilio SMS stayed retired when manual
 * texting came back (see docs/operations/communications-retirement.md).
 */
export async function sendProviderSmsMessage(input: SmsSendInput): Promise<SmsSendResult> {
  if (smsProvider() !== 'telnyx') return { ok: false, error: 'SMS delivery is disabled.' }
  return sendTelnyxSmsMessage(input)
}
