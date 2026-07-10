/** Absolute app host URL for Twilio callbacks (status, dial actions). */
export function twilioAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    'http://localhost:3002'
  )
}

export function twilioVoiceStatusCallbackUrl(): string {
  return `${twilioAppBaseUrl()}/api/webhooks/twilio/voice-status`
}

export function twilioInboundFallbackActionUrl(): string {
  return `${twilioAppBaseUrl()}/api/voice/inbound-fallback`
}

export function twilioInboundClientIdentities(): string[] {
  return (process.env.TWILIO_INBOUND_CLIENT_IDENTITIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function twilioInboundRingTimeout(): number {
  const parsed = Number.parseInt(process.env.TWILIO_INBOUND_RING_TIMEOUT ?? '20', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20
}

export function twilioInboundFallbackUrl(): string | null {
  const url = process.env.TWILIO_INBOUND_FALLBACK_URL?.trim()
  return url || null
}

export function twilioRecordCalls(): boolean {
  return process.env.TWILIO_RECORD_CALLS === 'true'
}

function envIsSet(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function appPublicUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    null
  )
}

export type TwilioVoiceConfigGroup = 'voiceCore' | 'outbound' | 'webhooks' | 'inbound'

export interface TwilioVoiceConfigStatus {
  voiceCoreConfigured: boolean
  outboundConfigured: boolean
  webhooksConfigured: boolean
  inboundConfigured: boolean
  missing: Record<TwilioVoiceConfigGroup, string[]>
  optionalUnset: string[]
}

const VOICE_CORE_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_TWIML_APP_SID',
] as const

const OUTBOUND_VARS = ['TWILIO_CALLER_ID'] as const

const WEBHOOK_VARS = ['TWILIO_AUTH_TOKEN'] as const

const INBOUND_VARS = ['TWILIO_INBOUND_CLIENT_IDENTITIES'] as const

const OPTIONAL_VOICE_VARS = [
  'TWILIO_INBOUND_FALLBACK_URL',
  'TWILIO_INBOUND_RING_TIMEOUT',
  'TWILIO_RECORD_CALLS',
  'TWILIO_WEBHOOK_BASE_URL',
] as const

/** Non-secret Twilio Voice env audit for admin diagnostics. */
export function getTwilioVoiceConfigStatus(): TwilioVoiceConfigStatus {
  const missingVoiceCore = VOICE_CORE_VARS.filter(name => !envIsSet(name))
  const missingOutbound = OUTBOUND_VARS.filter(name => !envIsSet(name))
  const missingWebhooks = [
    ...WEBHOOK_VARS.filter(name => !envIsSet(name)),
    ...(appPublicUrl() ? [] : ['NEXT_PUBLIC_APP_URL (or NEXT_PUBLIC_SITE_URL)']),
  ]
  const missingInbound = INBOUND_VARS.filter(name => !envIsSet(name))
  const optionalUnset = OPTIONAL_VOICE_VARS.filter(name => !envIsSet(name))

  return {
    voiceCoreConfigured: missingVoiceCore.length === 0,
    outboundConfigured: missingOutbound.length === 0,
    webhooksConfigured: missingWebhooks.length === 0,
    inboundConfigured: missingInbound.length === 0,
    missing: {
      voiceCore: [...missingVoiceCore],
      outbound: [...missingOutbound],
      webhooks: missingWebhooks,
      inbound: [...missingInbound],
    },
    optionalUnset: [...optionalUnset],
  }
}

export function isTwilioVoiceConfigured(): boolean {
  return getTwilioVoiceConfigStatus().voiceCoreConfigured
}

export function isTwilioSmsConfigured(): boolean {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
  const from =
    process.env.TWILIO_SMS_FROM?.trim() || process.env.TWILIO_CALLER_ID?.trim()
  return Boolean(accountSid && authToken && (messagingServiceSid || from))
}

export function dialStatusCallbackOptions() {
  return {
    statusCallback: twilioVoiceStatusCallbackUrl(),
    statusCallbackMethod: 'POST' as const,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'] as const,
  }
}
