import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { createDocumentRequest, listDocumentRequests } from '@/lib/documentRequests/repository'
import { normaliseRequestTitle } from '@/lib/documentRequests/model'
import { notifyClientOfDocumentRequest } from '@/lib/portalNotifications'

export const dynamic = 'force-dynamic'

// GET  /api/admin/matters/[id]/document-requests — every request on the matter.
// POST /api/admin/matters/[id]/document-requests — ask the client for one more.
//
// A staff request goes to the client at once: the row appears in the portal
// and one notice email is sent (several asks in one sitting send one). The
// meeting follow-up creates requests through the registry action instead,
// where the delegation dial decides.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json({ requests: await listDocumentRequests(id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Requests are unavailable' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { title?: unknown; description?: unknown; dueOn?: unknown; notify?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? normaliseRequestTitle(body.title) : ''
  if (!title) return NextResponse.json({ error: 'A title is required' }, { status: 400 })
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1_000) || null : null
  const dueOn = typeof body.dueOn === 'string' && body.dueOn.trim() ? body.dueOn.trim() : null
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return NextResponse.json({ error: 'dueOn must be a YYYY-MM-DD date' }, { status: 400 })

  try {
    const request = await createDocumentRequest({ matterId: id, title, description, dueOn, source: 'staff', requestedBy: auth.userId })
    if (body.notify !== false) void notifyClientOfDocumentRequest(id, title)
    return NextResponse.json({ request }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create the request' }, { status: 500 })
  }
}
