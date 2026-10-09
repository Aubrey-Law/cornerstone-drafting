import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { findMergeTargets } from '@/lib/matters/mergeTargets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/matters/[id]/merge?q= — leads and matters this one could be
 * merged into. With no query, the records sharing its client's email.
 */
export async function GET(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  const query = new URL(req.url).searchParams.get('q')?.slice(0, 100) ?? ''
  try {
    const targets = await findMergeTargets(getAdminClient(), id, query)
    return NextResponse.json({ targets })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not search' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/admin/matters/[id]/merge — merge this lead or matter into another.
 *
 * `[id]` is the record that goes away (archived, never deleted); `intoMatterId`
 * is the one that is kept. Everything that can move does, inside one database
 * transaction (`merge_matters`); what cannot — a second design sheet, a second
 * "self" person — stays readable on the archived record and is reported back.
 */
export async function POST(req: Request, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id: loserId } = await params
  const body = await req.json().catch(() => ({}))
  const winnerId = typeof body.intoMatterId === 'string' ? body.intoMatterId.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null

  if (!UUID_RE.test(loserId) || !UUID_RE.test(winnerId)) {
    return NextResponse.json({ error: 'intoMatterId is required' }, { status: 400 })
  }
  if (winnerId === loserId) {
    return NextResponse.json({ error: 'A matter cannot be merged into itself' }, { status: 400 })
  }

  const { data, error } = await getAdminClient().rpc('merge_matters', {
    p_winner_id: winnerId,
    p_loser_id: loserId,
    p_reason: reason,
    p_actor_id: userId,
  })

  if (error) {
    // The function's own validation (already merged, unknown matter) is a
    // conflict, not a server fault.
    const status = error.code === '22023' ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  const result = (data ?? {}) as {
    rows_moved?: Record<string, number>
    rows_left?: Record<string, number>
    drafting_moved?: boolean
  }
  return NextResponse.json({
    ok: true,
    intoMatterId: winnerId,
    rowsMoved: result.rows_moved ?? {},
    rowsLeft: result.rows_left ?? {},
    draftingMoved: result.drafting_moved === true,
  })
}
