import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { dialStatusCallbackOptions, twilioRecordCalls } from '@/lib/twilio/config'
import { parseTwilioForm } from '@/lib/twilio/form'
import { verifyTwilioRequest } from '@/lib/twilio/verify'

const { VoiceResponse } = twilio.twiml

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/voice — TwiML App Voice Request URL. Public URL, but only requests
 * signed by Twilio (X-Twilio-Signature) are answered.
 */
export async function POST(req: Request) {
  const params = await parseTwilioForm(req)
  if (!verifyTwilioRequest(req, params)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }
  const to = (params.To ?? '').trim()

  const callerId = process.env.TWILIO_CALLER_ID
  const twiml = new VoiceResponse()

  if (!to) {
    twiml.say('No destination was provided. Goodbye.')
  } else if (to.startsWith('+') || /^\d{10,}$/.test(to.replace(/\D/g, ''))) {
    const dial = twiml.dial({
      callerId: callerId ?? undefined,
      answerOnBridge: true,
      record: twilioRecordCalls() ? 'record-from-answer-dual' : undefined,
      ...dialStatusCallbackOptions(),
    })
    dial.number(to)
  } else {
    const dial = twiml.dial({
      callerId: callerId ?? undefined,
      record: twilioRecordCalls() ? 'record-from-answer-dual' : undefined,
      ...dialStatusCallbackOptions(),
    })
    dial.client(to)
  }

  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
