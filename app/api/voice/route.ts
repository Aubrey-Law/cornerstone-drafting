import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { dialStatusCallbackOptions, twilioRecordCalls } from '@/lib/twilio/config'

const { VoiceResponse } = twilio.twiml

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/voice — TwiML App Voice Request URL (public; Twilio POSTs here).
 */
export async function POST(req: Request) {
  const form = await req.formData()
  const to = (form.get('To') || '').toString().trim()

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
