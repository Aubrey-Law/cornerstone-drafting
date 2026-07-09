import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { parseTwilioForm } from '@/lib/twilio/form'
import { verifyTwilioRequest } from '@/lib/twilio/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const params = await parseTwilioForm(req)

  if (!verifyTwilioRequest(req, params)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const messageSid = params.MessageSid?.trim()
  if (!messageSid) {
    return NextResponse.json({ error: 'missing MessageSid' }, { status: 400 })
  }

  const status = params.MessageStatus?.trim() || params.SmsStatus?.trim() || 'unknown'
  const errorCode = params.ErrorCode?.trim()
  const errorMessage = params.ErrorMessage?.trim()
  const error =
    errorCode || errorMessage ? [errorCode, errorMessage].filter(Boolean).join(': ') : null

  const { error: updateError } = await getAdminClient()
    .from('sms_messages')
    .update({
      status,
      error,
      raw_payload: params,
    })
    .eq('provider_message_id', messageSid)

  if (updateError) {
    console.error('[twilio/sms-status] update error', { messageSid, error: updateError })
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
