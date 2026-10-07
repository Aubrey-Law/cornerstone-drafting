import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isUuid } from '@/lib/queries/tasks'
import { createListRequests, listDocumentRequests, RequestListUnavailableError } from '@/lib/documentRequests/repository'
import { planProbateSet, probateSetOptions } from '@/lib/documentRequests/probateSet'
import { notifyClientOfDocumentRequest } from '@/lib/portalNotifications'

export const dynamic = 'force-dynamic'

// GET  /api/admin/matters/[id]/document-requests/probate-list — the standard
//      probate list, each item marked with whether the matter already has it.
// POST /api/admin/matters/[id]/document-requests/probate-list — ask the client
//      for the items the attorney ticked. Items already on the matter are
//      skipped, and the client gets one notice for the whole list.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json({ items: probateSetOptions(await listDocumentRequests(id)) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The list is unavailable' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { keys?: unknown; dueOn?: unknown; notify?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.keys) || body.keys.length === 0 || !body.keys.every(key => typeof key === 'string')) {
    return NextResponse.json({ error: 'Choose at least one item' }, { status: 400 })
  }
  const dueOn = typeof body.dueOn === 'string' && body.dueOn.trim() ? body.dueOn.trim() : null
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return NextResponse.json({ error: 'dueOn must be a YYYY-MM-DD date' }, { status: 400 })

  try {
    const plan = planProbateSet(body.keys as string[], await listDocumentRequests(id))
    if (plan.unknown.length > 0) return NextResponse.json({ error: `Not on the list: ${plan.unknown.join(', ')}` }, { status: 400 })
    const created = await createListRequests({ matterId: id, items: plan.create, dueOn, requestedBy: auth.userId })
    if (created.length > 0 && body.notify !== false) void notifyClientOfDocumentRequest(id, created[0].title, created.length)
    return NextResponse.json({ created, skipped: plan.skipped }, { status: created.length > 0 ? 201 : 200 })
  } catch (error) {
    if (error instanceof RequestListUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not send the list' }, { status: 500 })
  }
}
