import { smsProvider, voiceProvider } from '@/lib/communications/providers'
import {
  telnyxInboundRouteConfig,
  telnyxInboundRoutingIssues,
} from '@/lib/telnyx/inbound'

export function telnyxAppBaseUrl(): string {
  return (
    process.env.TELNYX_WEBHOOK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3002'
  ).replace(/\/$/, '')
}

export function telnyxPhoneNumber(): string | null {
  return process.env.TELNYX_PHONE_NUMBER?.trim() || null
}

export function telnyxCredentialIdForUser(userId: string): string | null {
  const raw = process.env.TELNYX_TELEPHONY_CREDENTIAL_IDS?.trim()
  if (!raw) return process.env.TELNYX_TELEPHONY_CREDENTIAL_ID?.trim() || null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed[userId] === 'string' ? parsed[userId].trim() || null : null
  } catch {
    return null
  }
}

export function isTelnyxSmsConfigured(): boolean {
  return smsProvider() === 'telnyx' &&
    Boolean(process.env.TELNYX_API_KEY?.trim() && telnyxPhoneNumber())
}

export function isTelnyxVoiceConfigured(): boolean {
  const credentialsConfigured = !telnyxCredentialConfigurationIssue()
  return voiceProvider() === 'telnyx' &&
    Boolean(
      process.env.TELNYX_API_KEY?.trim() &&
      process.env.TELNYX_PUBLIC_KEY?.trim() &&
      process.env.TELNYX_CONNECTION_ID?.trim() &&
      credentialsConfigured,
    )
}

function telnyxCredentialConfigurationIssue(): string | null {
  if (
    process.env.TELNYX_TELEPHONY_CREDENTIAL_IDS?.trim() ||
    process.env.TELNYX_TELEPHONY_CREDENTIAL_ID?.trim()
  ) return null
  return 'TELNYX_TELEPHONY_CREDENTIAL_IDS or TELNYX_TELEPHONY_CREDENTIAL_ID'
}

export function telnyxConfigStatus() {
  const missing = (names: string[]) => names.filter(name => !process.env[name]?.trim())
  const credentialIssue = telnyxCredentialConfigurationIssue()
  const voiceMissing = [
    ...missing(['TELNYX_API_KEY', 'TELNYX_PUBLIC_KEY', 'TELNYX_CONNECTION_ID']),
    ...(credentialIssue ? [credentialIssue] : []),
  ]
  const inboundMissing = Array.from(new Set([
    ...(voiceProvider() === 'telnyx' ? [] : ['VOICE_PROVIDER=telnyx']),
    ...voiceMissing,
    ...telnyxInboundRoutingIssues(),
  ]))
  return {
    provider: 'telnyx' as const,
    smsConfigured: isTelnyxSmsConfigured(),
    voiceConfigured: isTelnyxVoiceConfigured(),
    inboundVoiceConfigured: inboundMissing.length === 0 && Boolean(telnyxInboundRouteConfig()),
    missing: {
      sms: missing(['TELNYX_API_KEY', 'TELNYX_PUBLIC_KEY', 'TELNYX_PHONE_NUMBER', 'TELNYX_MESSAGING_PROFILE_ID']),
      voice: voiceMissing,
      inboundVoice: inboundMissing,
    },
    webhooks: {
      messaging: `${telnyxAppBaseUrl()}/api/webhooks/telnyx/messaging`,
      voice: `${telnyxAppBaseUrl()}/api/webhooks/telnyx/voice`,
      inboundTeXML: `${telnyxAppBaseUrl()}/api/voice/telnyx/inbound`,
      texmlStatus: `${telnyxAppBaseUrl()}/api/webhooks/telnyx/texml`,
    },
  }
}
