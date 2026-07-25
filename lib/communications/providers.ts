export type CommunicationsProvider = 'twilio' | 'telnyx'

function provider(value: string | undefined): CommunicationsProvider {
  return value?.trim().toLowerCase() === 'telnyx' ? 'telnyx' : 'twilio'
}
export function smsProvider(): CommunicationsProvider {
  return provider(process.env.SMS_PROVIDER)
}

export function voiceProvider(): CommunicationsProvider {
  return provider(process.env.VOICE_PROVIDER)
}
