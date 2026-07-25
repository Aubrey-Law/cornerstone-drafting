import twilio from 'twilio'
import { twilioAppBaseUrl } from '@/lib/twilio/config'
import {
  normalizeSmsRecipient,
  type SmsSendInput,
  type SmsSendResult,
} from '@/lib/sms/transport'

export { normalizeSmsRecipient }
export type { SmsSendInput, SmsSendResult }

interface TwilioMessageCreateParams {
  to: string
  body: string
  from?: string
  messagingServiceSid?: string
  statusCallback: string
}

interface TwilioMessageResult {
  sid: string
  status: string
}

interface SmsSendDeps {
  createMessage?: (params: TwilioMessageCreateParams) => Promise<TwilioMessageResult>
}

export function smsStatusCallbackUrl(): string {
  return `${twilioAppBaseUrl()}/api/webhooks/twilio/sms-status`
}

function smsSenderConfig(): { messagingServiceSid: string } | { from: string } | null {
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
  if (messagingServiceSid) return { messagingServiceSid }

  const from = process.env.TWILIO_SMS_FROM?.trim() || process.env.TWILIO_CALLER_ID?.trim()
  if (from) return { from }

  return null
}

function createTwilioMessage(params: TwilioMessageCreateParams): Promise<TwilioMessageResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!accountSid || !authToken) {
    throw new Error('Twilio SMS is not configured.')
  }

  return twilio(accountSid, authToken).messages.create(params)
}

export async function sendSmsMessage(
  input: SmsSendInput,
  deps: SmsSendDeps = {},
): Promise<SmsSendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const sender = smsSenderConfig()

  if (!accountSid || !authToken || !sender) {
    return { ok: false, error: 'Twilio SMS is not configured.' }
  }

  try {
    const message = await (deps.createMessage ?? createTwilioMessage)({
      to: input.to,
      body: input.body,
      ...sender,
      statusCallback: smsStatusCallbackUrl(),
    })

    return {
      ok: true,
      providerMessageId: message.sid,
      status: message.status,
      to: input.to,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'SMS send failed.',
    }
  }
}
