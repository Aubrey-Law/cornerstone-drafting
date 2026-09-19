import { NextResponse } from 'next/server'
import { readConsentToken } from '@/lib/marketing/consentTokens'
import { recordConfirmedConsent } from '@/lib/marketing/consent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/marketing/confirm — the second half of a double opt-in.
 *
 * Authorization is possession of a token this app signed and emailed to the
 * address being confirmed, which is the only credential a person with no
 * account can have. Same basis as the scheduling manage links.
 *
 * POST, not GET, and that is the substantive part. Mail clients and security
 * scanners fetch the links in a message before anyone reads it, so if following
 * the emailed link were itself the confirmation, a scanner would opt someone in
 * and the firm's record would claim a person consented when no person had acted.
 * The link lands on /marketing/confirm, which renders a button that posts here.
 *
 * This was first written as a server action. It is a route because
 * tests/server-action-auth.test.ts holds — correctly — that every exported
 * server action authorizes its own caller, and a token-authorized public
 * action cannot satisfy that. Public routes are where this codebase puts
 * anonymous access, listed with a reason in tests/api-route-auth.test.ts.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { token?: unknown } | null

  const read = readConsentToken(body?.token)
  if (!read.ok) {
    // 'expired' is separated from everything else so the page can tell someone
    // whose link simply aged out to request a new one, rather than showing them
    // the same dead end as a forged token.
    return NextResponse.json(
      { ok: false, reason: read.reason === 'expired' ? 'expired' : 'invalid' },
      { status: read.reason === 'expired' ? 410 : 400 },
    )
  }

  try {
    // Idempotent: re-confirming restamps the same permission with a later
    // timestamp, which is the honest record of the most recent time the person
    // said yes. Not an error, and it must not read as one.
    const { matched } = await recordConfirmedConsent(read.email, read.source)
    // `matched: 0` is normal — someone who has never contacted the firm has no
    // CRM row and should not be given one. Reported so the response is not
    // silently identical to a row having been stamped.
    return NextResponse.json({ ok: true, matched })
  } catch (e) {
    console.error('[marketing/confirm] consent write failed', e)
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 })
  }
}
