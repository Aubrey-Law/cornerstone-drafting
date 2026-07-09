import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { parseTwilioForm } from '@/lib/twilio/form'
import { twilioInboundFallbackUrl } from '@/lib/twilio/config'

const { VoiceResponse } = twilio.twiml

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/voice/inbound-fallback
 * Twilio Dial action URL after browser ring attempt on the business line.
 */
export async function POST(req: Request) {
  const params = await parseTwilioForm(req)
  const dialStatus = (params.DialCallStatus ?? '').toLowerCase()

  const twiml = new VoiceResponse()
  const fallbackUrl = twilioInboundFallbackUrl()

  if (dialStatus === 'completed') {
    twiml.hangup()
  } else if (fallbackUrl) {
    twiml.redirect({ method: 'POST' }, fallbackUrl)
  } else {
    twiml.say('No one is available to take your call. Goodbye.')
    twiml.hangup()
  }

  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
