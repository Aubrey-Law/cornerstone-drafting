import { smsProvider, voiceProvider } from '@/lib/communications/providers'
import { isTelnyxSmsConfigured, isTelnyxVoiceConfigured } from '@/lib/telnyx/config'
import { isTwilioSmsConfigured, isTwilioVoiceConfigured } from '@/lib/twilio/config'

export function isSmsConfigured(): boolean {
  return smsProvider() === 'telnyx' ? isTelnyxSmsConfigured() : isTwilioSmsConfigured()
}
export function isVoiceConfigured(): boolean {
  return voiceProvider() === 'telnyx' ? isTelnyxVoiceConfigured() : isTwilioVoiceConfigured()
}
