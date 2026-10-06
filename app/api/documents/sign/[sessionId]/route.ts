import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { resolvePortalSigningSession } from '@/lib/portal/signaturesServer'
import { openSigningSession, submitSigning, type SigningSessionRow } from '@/lib/esign/signingFlow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/documents/sign/[sessionId] — the portal's door to the signing flow.
 *
 * The public route admits whoever holds the emailed token. This one admits the
 * signed-in client instead: the session must be on the client's own matter and
 * addressed to the email their account signs in with. Both checks run on every
 * call, and the session id in the URL is only ever used to find a row those
 * checks then vet. The signing itself is lib/esign/signingFlow.ts, the same
 * code the token route runs, so a signature made here is recorded, sealed and
 * filed identically.
 */

async function authorise(req: Request, sessionId: string): Promise<
  { ok: true; session: SigningSessionRow } | { ok: false; status: number; error: string }
> {
  const user = await getBearerUser(req)
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  const matter = await getMatterForUser(getAdminClient(), user.id)
  if (!matter) return { ok: false, status: 404, error: 'This document is not available to sign here' }
  return resolvePortalSigningSession({ sessionId, matterId: matter.id, userEmail: user.email ?? null })
}

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const authorised = await authorise(req, sessionId)
  if (!authorised.ok) return NextResponse.json({ error: authorised.error }, { status: authorised.status })
  return NextResponse.json(await openSigningSession(authorised.session, req))
}

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const authorised = await authorise(req, sessionId)
  if (!authorised.ok) return NextResponse.json({ error: authorised.error }, { status: authorised.status })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const outcome = await submitSigning(authorised.session, body, req)
  return NextResponse.json(outcome.body, { status: outcome.status })
}
