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

export function isTwilioVoiceConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_API_KEY_SID?.trim() &&
      process.env.TWILIO_API_KEY_SECRET?.trim() &&
      process.env.TWILIO_TWIML_APP_SID?.trim(),
  )
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
