import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { decideDocumentRequest, deleteUnansweredDocumentRequest, type DocumentRequestDecision } from '@/lib/documentRequests/repository'

export const dynamic = 'force-dynamic'

// PATCH  /api/admin/matters/[id]/document-requests/[requestId] — accept, waive or reopen.
// DELETE /api/admin/matters/[id]/document-requests/[requestId] — take back a request nothing arrived against.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, requestId } = await params
  if (!isUuid(id) || !isUuid(requestId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { decision?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  let decision: DocumentRequestDecision
  switch (body.decision) {
    case 'accept':
      decision = { kind: 'accept', actorId: auth.userId }
      break
    case 'waive':
      decision = { kind: 'waive', actorId: auth.userId, reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null }
      break
    case 'reopen':
      decision = { kind: 'reopen' }
      break
    default:
      return NextResponse.json({ error: 'decision must be accept, waive or reopen' }, { status: 400 })
  }

  try {
    const request = await decideDocumentRequest({ requestId, matterId: id, decision })
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ request })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update the request' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id, requestId } = await params
  if (!isUuid(id) || !isUuid(requestId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const deleted = await deleteUnansweredDocumentRequest(requestId)
    if (!deleted) {
      return NextResponse.json({ error: 'Only a request nothing has arrived against can be removed; waive it instead' }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not remove the request' }, { status: 500 })
  }
}
