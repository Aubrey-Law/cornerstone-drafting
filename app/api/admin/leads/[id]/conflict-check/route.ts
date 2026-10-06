import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { decideConflictCheck, fetchLatestConflictCheck, runConflictCheck } from '@/lib/conflicts/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function leadExists(id: string): Promise<boolean> {
  const { data } = await getAdminClient().from('client_intake').select('id').eq('id', id).not('lead_status', 'is', null).maybeSingle()
  return Boolean(data)
}

/** GET — the lead's current conflict check. */
export async function GET(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  try {
    return NextResponse.json({ check: await fetchLatestConflictCheck(id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load the conflict check' }, { status: 500 })
  }
}

/** POST — run (or re-run) the search now, as the signed-in attorney. */
export async function POST(req: Request, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { id } = await params
  if (!isUuid(id) || !(await leadExists(id))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  try {
    const check = await runConflictCheck({ leadId: id, actorId: userId })
    if (!check) return NextResponse.json({ error: 'The conflict check could not run' }, { status: 503 })
    return NextResponse.json({ check })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not run the conflict check' }, { status: 500 })
  }
}

/** PATCH — record the decision on the current run: no conflict, or conflict. */
export async function PATCH(req: Request, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const body = await req.json().catch(() => null) as { checkId?: unknown; decision?: unknown; note?: unknown } | null
  const checkId = typeof body?.checkId === 'string' ? body.checkId : ''
  const decision = body?.decision
  if (!isUuid(checkId) || (decision !== 'no_conflict' && decision !== 'conflict')) {
    return NextResponse.json({ error: 'A check and a decision (no_conflict or conflict) are required' }, { status: 400 })
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1_000) || null : null
  try {
    const check = await decideConflictCheck({ leadId: id, checkId, decision, note, actorId: userId as string })
    if (!check) return NextResponse.json({ error: 'That check is not on this lead' }, { status: 404 })
    return NextResponse.json({ check })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not record the decision' }, { status: 500 })
  }
}
