import { smsProvider, voiceProvider } from '@/lib/communications/providers'

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
  const credentialsConfigured = Boolean(
    process.env.TELNYX_TELEPHONY_CREDENTIAL_IDS?.trim() ||
    process.env.TELNYX_TELEPHONY_CREDENTIAL_ID?.trim(),
  )
  return voiceProvider() === 'telnyx' &&
    Boolean(
      process.env.TELNYX_API_KEY?.trim() &&
      process.env.TELNYX_PUBLIC_KEY?.trim() &&
      process.env.TELNYX_CONNECTION_ID?.trim() &&
      credentialsConfigured,
    )
}

export function telnyxConfigStatus() {
  const missing = (names: string[]) => names.filter(name => !process.env[name]?.trim())
  return {
    provider: 'telnyx' as const,
    smsConfigured: isTelnyxSmsConfigured(),
    voiceConfigured: isTelnyxVoiceConfigured(),
    missing: {
      sms: missing(['TELNYX_API_KEY', 'TELNYX_PUBLIC_KEY', 'TELNYX_PHONE_NUMBER', 'TELNYX_MESSAGING_PROFILE_ID']),
      voice: [
        ...missing(['TELNYX_API_KEY', 'TELNYX_PUBLIC_KEY', 'TELNYX_CONNECTION_ID']),
        ...(!process.env.TELNYX_TELEPHONY_CREDENTIAL_IDS?.trim() &&
        !process.env.TELNYX_TELEPHONY_CREDENTIAL_ID?.trim()
          ? ['TELNYX_TELEPHONY_CREDENTIAL_IDS or TELNYX_TELEPHONY_CREDENTIAL_ID']
          : []),
      ],
    },
    webhooks: {
      messaging: `${telnyxAppBaseUrl()}/api/webhooks/telnyx/messaging`,
      voice: `${telnyxAppBaseUrl()}/api/webhooks/telnyx/voice`,
    },
  }
}
