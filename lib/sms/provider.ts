import { normalizeSmsRecipient, type SmsSendInput, type SmsSendResult } from '@/lib/sms/transport'

export { normalizeSmsRecipient }

/** Compatibility boundary for retired callers. Never initiates delivery. */
export async function sendProviderSmsMessage(_input: SmsSendInput): Promise<SmsSendResult> {
  return { ok: false, error: 'SMS delivery is disabled.' }
}
