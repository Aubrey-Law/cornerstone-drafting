export type CommunicationsProvider = 'twilio' | 'telnyx' | 'none'

function provider(value: string | undefined, key: string): CommunicationsProvider {
  const selected = value?.trim().toLowerCase() || 'twilio'
  if (selected === 'twilio' || selected === 'telnyx' || selected === 'none') return selected
  throw new Error(`${key} must be twilio, telnyx, or none`)
}
export function smsProvider(): CommunicationsProvider {
  return provider(process.env.SMS_PROVIDER, 'SMS_PROVIDER')
}

export function voiceProvider(): CommunicationsProvider {
  return provider(process.env.VOICE_PROVIDER, 'VOICE_PROVIDER')
}

/** Manual controls are independent of automated reminders and callbacks. */
export function manualCommunicationsEnabled(): boolean {
  const value = process.env.MANUAL_COMMUNICATIONS_ENABLED?.trim().toLowerCase()
  if (value === 'true') return true
  if (value === undefined || value === '') return false
  if (value === 'false') return false
  throw new Error('MANUAL_COMMUNICATIONS_ENABLED must be true or false')
}
