import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { requireAdmin } from '@/lib/apiAuth'

const { AccessToken } = twilio.jwt
const { VoiceGrant } = AccessToken

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getTwilioEnv() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKeySid = process.env.TWILIO_API_KEY_SID
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    return null
  }

  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid }
}

/**
 * GET /api/token — Twilio Voice Access Token for the logged-in attorney/admin.
 */
export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const env = getTwilioEnv()
  if (!env) {
    return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 })
  }

  const identity = userId

  const token = new AccessToken(env.accountSid, env.apiKeySid, env.apiKeySecret, {
    identity,
    ttl: 3600,
  })

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: env.twimlAppSid,
      incomingAllow: true,
    }),
  )

  return NextResponse.json({ token: token.toJwt(), identity })
}
