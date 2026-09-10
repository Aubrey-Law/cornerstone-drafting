import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_STATUSES, matterStatusLabel, type MatterStatus } from '@/types/database'
import {
  archiveTasksForClosedRecord,
  restoreTasksForReopenedRecord,
} from '@/lib/tasks/closeout'

type Params = { params: Promise<{ id: string }> }

const VALID_STATUSES = new Set<MatterStatus>(MATTER_STATUSES.map(s => s.key))

/**
 * PATCH /api/admin/matters/[id]/status — move a matter along the work axis.
 *
 * Sibling of the stage route, and deliberately separate from it: stage is where
 * the work has got to, status is whether it is running at all. `closed_at`,
 * `on_hold_at` and the clearing of a stale `hold_reason` are stamped by the
 * trigger from 20260824000000, so this only writes the status and the reason.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const { id: rawId } = await params
  const body = (await req.json().catch(() => null)) as
    | { status?: string; holdReason?: string | null }
    | null
  const status = body?.status

  if (!status || !VALID_STATUSES.has(status as MatterStatus)) {
    return NextResponse.json({ error: 'A valid status is required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const matterId = await resolveMatterId(rawId, admin).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const holdReason =
      status === 'on_hold' && typeof body?.holdReason === 'string' && body.holdReason.trim()
        ? body.holdReason.trim()
        : null

    const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null
    const { data, error } = await admin.rpc('transition_matter_status_with_closeout', {
      p_matter_id: matterId,
      p_status: status,
      p_hold_reason: holdReason,
      p_status_label: matterStatusLabel(status),
      p_actor_id: userId,
      p_actor_email: user?.email ?? null,
      p_actor_name: actorName,
    })
    if (error) {
      const code = error.code === 'P0002' ? 404 : error.code === 'P0001' ? 409 : 500
      return NextResponse.json({ error: error.message }, { status: code })
    }

    // Only after the transition has committed. `on_hold` is deliberately not
    // here: a paused matter still has work coming, and the SLA already knows
    // how to stop its clock.
    const actor = { id: userId, email: user?.email ?? null, name: actorName }
    if (status === 'closed' || status === 'archived') {
      await archiveTasksForClosedRecord(admin, { matterId }, 'matter_closed', actor)
    } else if (status === 'active') {
      await restoreTasksForReopenedRecord(admin, { matterId }, actor)
    }

    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
