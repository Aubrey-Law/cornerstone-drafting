import { manualCommunicationsEnabled, voiceProvider } from '@/lib/communications/providers'
import { isTelnyxSmsConfigured, isTelnyxVoiceConfigured } from '@/lib/telnyx/config'
import { isTwilioVoiceConfigured } from '@/lib/twilio/config'

/**
 * Staff texting is Telnyx-only and needs two deliberate settings:
 * SMS_PROVIDER=telnyx and MANUAL_COMMUNICATIONS_ENABLED=true. Leftover
 * provider credentials alone never turn sending back on.
 */
export function isSmsConfigured(): boolean {
  return manualCommunicationsEnabled() && isTelnyxSmsConfigured()
}
export function isVoiceConfigured(): boolean {
  if (voiceProvider() === 'none') return false
  return voiceProvider() === 'telnyx' ? isTelnyxVoiceConfigured() : isTwilioVoiceConfigured()
}
