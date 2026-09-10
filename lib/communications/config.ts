import { voiceProvider } from '@/lib/communications/providers'
import { isTelnyxVoiceConfigured } from '@/lib/telnyx/config'
import { isTwilioVoiceConfigured } from '@/lib/twilio/config'

/** SMS delivery has been retired; historical provider settings are retained. */
export function isSmsConfigured(): boolean {
  return false
}
export function isVoiceConfigured(): boolean {
  if (voiceProvider() === 'none') return false
  return voiceProvider() === 'telnyx' ? isTelnyxVoiceConfigured() : isTwilioVoiceConfigured()
}
