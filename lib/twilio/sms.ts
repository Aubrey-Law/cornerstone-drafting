import twilio from 'twilio'
import { twilioAppBaseUrl } from '@/lib/twilio/config'

const SMS_EXTENSION_PATTERN = /\b(?:ext\.?|extension|x)\s*[0-9][0-9 .-]*$/i

export interface SmsSendInput {
  to: string
  body: string
}

export interface SmsSendSuccess {
  ok: true
  providerMessageId: string
  status: string
  to: string
}

export interface SmsSendFailure {
  ok: false
  error: string
}

export type SmsSendResult = SmsSendSuccess | SmsSendFailure

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

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function normalizeSmsRecipient(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (SMS_EXTENSION_PATTERN.test(trimmed)) return null

  const digits = digitsOnly(trimmed)
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
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
