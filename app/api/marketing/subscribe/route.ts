import { NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rateLimit'
import { sendEmail } from '@/lib/email/send'
import { appUrl } from '@/lib/urls'
import { createConsentToken, normalizeEmail } from '@/lib/marketing/consentTokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/marketing/subscribe — start a double opt-in.
 *
 * Anonymous by design: this is how someone asks to hear from the firm. It sends
 * one confirmation email and records nothing. Consent is written only when the
 * link in that email is followed (app/marketing/confirm), because until then
 * all anyone has proved is that they can type an address.
 *
 * The abuse this endpoint invites is email bombing — it sends mail to an address
 * chosen by the caller, so without limits it is a free relay for harassing a
 * third party. Three controls, in order of how much they matter:
 *
 *   Turnstile stops the volume.
 *   The per-address limit stops a targeted attack that solves Turnstile,
 *     because it caps how many confirmation emails one victim can be sent
 *     however many different callers ask.
 *   The per-IP limit stops one caller spraying many addresses.
 *
 * The response is the same whatever happens after validation, so nothing here
 * reveals whether an address is already known to the firm or has already been
 * sent a confirmation.
 */

const NEUTRAL = {
  ok: true,
  message: 'Check your email for a link to confirm your subscription.',
} as const

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown'
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  // Same posture as app/api/intake/register: unconfigured is a pass outside
  // production so local work is possible, and a hard fail in production.
  if (!secret) return process.env.NODE_ENV !== 'production'
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    cache: 'no-store',
  })
  if (!response.ok) return false
  const result = await response.json().catch(() => null) as { success?: boolean } | null
  return result?.success === true
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    email?: unknown
    turnstileToken?: unknown
    source?: unknown
  } | null

  const email = normalizeEmail(body?.email)
  if (!email) {
    return NextResponse.json({ ok: false, message: 'Enter a valid email address.' }, { status: 400 })
  }

  const ip = clientIp(req)
  const turnstileToken = typeof body?.turnstileToken === 'string' ? body.turnstileToken.trim() : ''
  if (!await verifyTurnstile(turnstileToken, ip)) {
    return NextResponse.json({ ok: false, message: 'Verification failed. Please try again.' }, { status: 400 })
  }

  // One caller spraying addresses. Told plainly, because a real person who hits
  // this is retrying a form and should know to wait.
  const perIp = await consumeRateLimit(
    { bucket: 'marketing_subscribe_ip', limit: 5, windowSeconds: 3600 },
    ip,
  )
  if (!perIp.ok) {
    return NextResponse.json(
      { ok: false, message: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(perIp.retryAfterSeconds) } },
    )
  }

  // One address being targeted. Answered with the neutral success rather than a
  // 429: the person typing is not the person being mailed, and telling them
  // they have hit a limit confirms the address is under attack while doing
  // nothing to help the victim.
  const perEmail = await consumeRateLimit(
    { bucket: 'marketing_subscribe_email', limit: 3, windowSeconds: 86_400 },
    email,
  )
  if (!perEmail.ok) return NextResponse.json(NEUTRAL)

  // Carried in the signed token rather than stored now: there is nothing to
  // store until consent exists, and the token is what the confirm step trusts.
  const confirmUrl = appUrl(
    `/marketing/confirm?token=${encodeURIComponent(createConsentToken(email, body?.source))}`,
  )

  const result = await sendEmail({
    category: 'marketing_optin_confirm',
    to: email,
    subject: 'Confirm your subscription',
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222;line-height:1.5">
      <p>Someone asked to subscribe this address to updates from Aubrey Law.</p>
      <p><a href="${confirmUrl}" style="color:#1a6b72">Confirm your subscription →</a></p>
      <p style="color:#666">If that was not you, ignore this email — nothing will be sent and
      this address will not be added to any list. The link expires in seven days.</p>
    </div>`,
    text: [
      'Someone asked to subscribe this address to updates from Aubrey Law.',
      '',
      `Confirm your subscription: ${confirmUrl}`,
      '',
      'If that was not you, ignore this email — nothing will be sent and this address',
      'will not be added to any list. The link expires in seven days.',
    ].join('\n'),
  })

  // A send failure is logged in email_log by sendEmail. It is not reported here:
  // the caller cannot act on it, and the alternative is a response that differs
  // by address, which is what the neutral reply exists to avoid.
  if (!result.ok) console.error('[marketing/subscribe] confirmation send failed', result.error)

  return NextResponse.json(NEUTRAL)
}
