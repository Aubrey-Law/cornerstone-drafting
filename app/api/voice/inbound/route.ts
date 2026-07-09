import { NextResponse } from 'next/server'
import twilio from 'twilio'
import {
  dialStatusCallbackOptions,
  twilioInboundClientIdentities,
  twilioInboundFallbackActionUrl,
  twilioInboundFallbackUrl,
  twilioInboundRingTimeout,
  twilioRecordCalls,
} from '@/lib/twilio/config'

const { VoiceResponse } = twilio.twiml

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function xmlResponse(twiml: InstanceType<typeof VoiceResponse>) {
  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}

/**
 * POST /api/voice/inbound — business-line Voice URL.
 * Rings browser softphones, then falls through to TWILIO_INBOUND_FALLBACK_URL.
 */
export async function POST() {
  const twiml = new VoiceResponse()
  const identities = twilioInboundClientIdentities()
  const fallbackUrl = twilioInboundFallbackUrl()

  if (identities.length === 0 || !fallbackUrl) {
    if (fallbackUrl) {
      twiml.redirect({ method: 'POST' }, fallbackUrl)
    } else {
      twiml.say('We are unable to take your call right now. Please try again later.')
      twiml.hangup()
    }
    return xmlResponse(twiml)
  }

  const dial = twiml.dial({
    timeout: twilioInboundRingTimeout(),
    action: twilioInboundFallbackActionUrl(),
    method: 'POST',
    answerOnBridge: true,
    record: twilioRecordCalls() ? 'record-from-answer-dual' : undefined,
    ...dialStatusCallbackOptions(),
  })

  for (const identity of identities) {
    dial.client(identity)
  }

  return xmlResponse(twiml)
}
