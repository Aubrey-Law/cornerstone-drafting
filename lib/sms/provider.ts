import { smsProvider } from '@/lib/communications/providers'
import { sendSmsMessage as sendTwilioSmsMessage } from '@/lib/twilio/sms'
import { sendTelnyxSmsMessage } from '@/lib/telnyx/sms'
import {
  normalizeSmsRecipient,
  type SmsSendInput,
  type SmsSendResult,
} from '@/lib/sms/transport'

export { normalizeSmsRecipient }

export async function sendProviderSmsMessage(input: SmsSendInput): Promise<SmsSendResult> {
  return smsProvider() === 'telnyx'
    ? sendTelnyxSmsMessage(input)
    : sendTwilioSmsMessage(input)
}
