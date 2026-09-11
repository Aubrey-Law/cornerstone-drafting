import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { smsProvider, voiceProvider, manualCommunicationsEnabled } from '@/lib/communications/providers'
import { isSmsConfigured, isVoiceConfigured } from '@/lib/communications/config'
import { telnyxConfigStatus } from '@/lib/telnyx/config'
import { getTwilioVoiceConfigStatus } from '@/lib/twilio/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const sms = smsProvider()
  const voice = voiceProvider()
  return NextResponse.json({
    providers: { sms, voice },
    manualEnabled: manualCommunicationsEnabled(),
    sms: { configured: isSmsConfigured() },
    voice: { configured: isVoiceConfigured() },
    telnyx: telnyxConfigStatus(),
    twilio: voice === 'twilio' ? getTwilioVoiceConfigStatus() : null,
  })
}
