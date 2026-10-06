import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { hashSigningToken } from '@/lib/esign/nativeTokens'
import {
  gateRefusal,
  openSigningSession,
  SIGNING_SESSION_COLUMNS,
  submitSigning,
  type SigningSessionRow,
} from '@/lib/esign/signingFlow'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/sign/[token] — a client opens, signs or declines from their emailed link.
 *
 * Public by design: the token is the credential, and it is verified here
 * rather than by the proxy, which does not match this path. That follows the
 * pattern already used by the booking manage links and intake invites — the
 * security boundary is the hash comparison below, not a database policy.
 *
 * The route reads through the service-role client because no signed-in user
 * exists. Everything it will act on is scoped by the session the token
 * resolves to; nothing here takes an id from the request body. The signing
 * itself lives in lib/esign/signingFlow.ts, shared with the portal's door
 * (/api/documents/sign/[sessionId]) so the two cannot drift.
 */

/** Resolve a presented token to its session, or explain why it cannot be used. */
async function resolveSession(token: string): Promise<
  { ok: true; session: SigningSessionRow } | { ok: false; status: number; error: string }
> {
  const admin = getAdminClient()
  // Look up by hash. The raw token is never stored, so this is the only way to
  // find the row — and it means a database dump yields no usable links.
  const { data, error } = await admin
    .from('esign_signing_sessions')
    .select(SIGNING_SESSION_COLUMNS)
    .eq('token_hash', hashSigningToken(token))
    .maybeSingle()
  if (error) {
    console.error('[esign sign] session lookup failed', error)
    return { ok: false, status: 500, error: 'Could not open this signing link' }
  }
  // A wrong token and a revoked one look identical on purpose: neither tells
  // the holder whether a link ever existed.
  if (!data) return { ok: false, status: 404, error: 'This signing link is not valid' }

  const refusal = gateRefusal(data as SigningSessionRow)
  if (refusal) return refusal
  return { ok: true, session: data as SigningSessionRow }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await guardPublicSchedulingRoute(req, 'esign-sign', 20)
  if (limited) return limited

  const { token } = await params
  const resolved = await resolveSession(token)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const outcome = await submitSigning(resolved.session, body, req)
  return NextResponse.json(outcome.body, { status: outcome.status })
}

/** GET — the signing page's own data fetch; also records that it was opened. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  // Its own bucket, and a generous one.
  //
  // Separate from the POST bucket on purpose: this is the fetch the page makes
  // on load, and sharing a counter would let a client's reloads eat the budget
  // they need to actually submit their signature. That is the worst possible
  // coupling on this endpoint.
  //
  // 60/min because the cost of a false 429 here is a client who cannot open
  // their fee agreement, and the traffic this is guarding against is not human.
  // SigningExperience fetches this exactly once per page load and never polls,
  // so a real signer spends one — a dozen even while reloading in frustration,
  // and several signers can share one address behind household or carrier NAT.
  // Sixty is a request a second, which no one reaches by hand while still
  // capping a script. It matches scheduling_availability, the other endpoint
  // whose traffic is "a public page rendering itself".
  //
  // consumeRateLimit fails open if its RPC errors, which is the right way round
  // here: serving the agreement beats refusing it over a database hiccup.
  const limited = await guardPublicSchedulingRoute(req, 'esign-view', 60)
  if (limited) return limited

  const { token } = await params
  const resolved = await resolveSession(token)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  return NextResponse.json(await openSigningSession(resolved.session, req))
}
