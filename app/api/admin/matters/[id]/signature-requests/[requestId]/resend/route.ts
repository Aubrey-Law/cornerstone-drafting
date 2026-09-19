import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { DocumentSignatureError, resendDocumentSignatureLink } from '@/lib/esign/documentLifecycle'
import { scopeRequestToMatter } from '../_scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/matters/[id]/signature-requests/[requestId]/resend
 *
 * Send one signer a fresh link. Per signer rather than to everyone: a resend
 * is an email to a client, and the caller has to say who — the engagement path
 * refuses a blanket resend for the same reason.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: matterId, requestId } = await params
  const scope = await scopeRequestToMatter(matterId, requestId)
  if (!scope.ok) return scope.response

  let body: { recipientKey?: unknown; expirationHours?: unknown; message?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const recipientKey = typeof body.recipientKey === 'string' ? body.recipientKey.trim() : ''
  if (!recipientKey) {
    return NextResponse.json({ error: 'Choose which signer to send a new link to' }, { status: 400 })
  }

  try {
    const result = await resendDocumentSignatureLink({
      requestId,
      recipientKey,
      ...(typeof body.expirationHours === 'number' && body.expirationHours > 0
        ? { expirationHours: body.expirationHours }
        : {}),
      ...(typeof body.message === 'string' ? { message: body.message } : {}),
    })
    return NextResponse.json({ ok: true, email: result.email })
  } catch (error) {
    if (error instanceof DocumentSignatureError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[signature-requests] resend failed', error)
    return NextResponse.json({ error: 'Could not send a new link' }, { status: 500 })
  }
}
