import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { cancelDocumentSignatureRequest, DocumentSignatureError } from '@/lib/esign/documentLifecycle'
import { scopeRequestToMatter } from '../_scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/matters/[id]/signature-requests/[requestId]/cancel
 *
 * Withdraw a request from whoever it was sent to. The service closes the
 * signing sessions before it marks the request cancelled, which is what
 * actually stops the links already in a client's inbox.
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

  let body: { reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  // The reason is stored on the audit row and read back off the certificate.
  // It is also the confirmation: a sentence someone chose to write proves more
  // than a boolean the client always sends.
  if (!reason) {
    return NextResponse.json({ error: 'Say why this request is being withdrawn' }, { status: 400 })
  }

  try {
    await cancelDocumentSignatureRequest({ requestId, reason, cancelledBy: auth.userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof DocumentSignatureError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[signature-requests] cancel failed', error)
    return NextResponse.json({ error: 'Could not withdraw this request' }, { status: 500 })
  }
}
