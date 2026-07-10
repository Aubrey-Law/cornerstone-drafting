import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  getTwilioVoiceConfigStatus,
  isTwilioSmsConfigured,
  twilioAppBaseUrl,
  twilioInboundClientIdentities,
  twilioInboundFallbackUrl,
  twilioInboundRingTimeout,
  twilioRecordCalls,
  twilioVoiceStatusCallbackUrl,
} from '@/lib/twilio/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/twilio/status — admin-only Twilio Voice/SMS env audit (no secrets).
 */
export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const voice = getTwilioVoiceConfigStatus()
  const inboundIdentities = twilioInboundClientIdentities()

  return NextResponse.json({
    voice: {
      fabVisible: voice.voiceCoreConfigured,
      tokenReady: voice.voiceCoreConfigured,
      outboundReady: voice.voiceCoreConfigured && voice.outboundConfigured,
      webhooksReady: voice.webhooksConfigured,
      inboundReady: voice.inboundConfigured,
      missing: voice.missing,
      optionalUnset: voice.optionalUnset,
      inboundIdentityCount: inboundIdentities.length,
      currentUserInInboundRingList: userId ? inboundIdentities.includes(userId) : false,
      inboundRingTimeoutSeconds: twilioInboundRingTimeout(),
      recordCalls: twilioRecordCalls(),
      inboundFallbackConfigured: Boolean(twilioInboundFallbackUrl()),
    },
    sms: {
      configured: isTwilioSmsConfigured(),
    },
    urls: {
      appBaseUrl: twilioAppBaseUrl(),
      voiceOutbound: `${twilioAppBaseUrl()}/api/voice`,
      voiceInbound: `${twilioAppBaseUrl()}/api/voice/inbound`,
      voiceStatusCallback: twilioVoiceStatusCallbackUrl(),
    },
  })
}
