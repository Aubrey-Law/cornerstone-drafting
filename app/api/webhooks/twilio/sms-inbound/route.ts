import { parseTwilioForm } from '@/lib/twilio/form'
import { verifyTwilioRequest } from '@/lib/twilio/verify'
import {
  recordInboundSms,
  twilioInboundSmsResponse,
} from '@/lib/sms/inbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const params = await parseTwilioForm(req)

  if (!verifyTwilioRequest(req, params)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const messageSid = params.MessageSid?.trim()
  const from = params.From?.trim()
  const to = params.To?.trim()
  const body = params.Body ?? ''

  if (!messageSid || !from || !to) {
    return new Response('Bad Request', { status: 400 })
  }

  const result = await recordInboundSms({
    fromNumber: from,
    toNumber: to,
    body,
    providerMessageId: messageSid,
    rawPayload: params,
    provider: 'twilio',
  })

  if (!result.ok) {
    console.error('[twilio/sms-inbound] record error', result.error)
    return new Response('Internal Server Error', { status: 500 })
  }

  if (result.duplicate) {
    return twilioInboundSmsResponse()
  }

  return twilioInboundSmsResponse()
}
