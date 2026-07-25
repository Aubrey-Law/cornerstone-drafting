import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { requireAdmin } from '@/lib/apiAuth'
import { voiceProvider } from '@/lib/communications/providers'
import { getTelnyxClient } from '@/lib/telnyx/client'
import { telnyxCredentialIdForUser } from '@/lib/telnyx/config'

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

  if (voiceProvider() === 'telnyx') {
    const credentialId = telnyxCredentialIdForUser(userId)
    if (!credentialId) {
      return NextResponse.json({ error: 'No Telnyx credential is configured for this user' }, { status: 503 })
    }
    try {
      const token = await getTelnyxClient().telephonyCredentials.createToken(credentialId)
      return NextResponse.json({
        provider: 'telnyx',
        token,
        identity: userId,
        callerNumber: process.env.TELNYX_PHONE_NUMBER?.trim() || null,
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not issue Telnyx token' },
        { status: 502 },
      )
    }
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

  return NextResponse.json({ provider: 'twilio', token: token.toJwt(), identity })
}
