import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_STATUSES, matterStatusLabel, type MatterStatus } from '@/types/database'

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
    const matterId = await resolveMatterId(rawId, admin)

    const { data: existing, error: fetchError } = await admin
      .from('matters')
      .select('id, status, relationship_status')
      .eq('id', matterId)
      .eq('relationship_status', 'hired')
      .maybeSingle()

    if (fetchError) throw new Error(fetchError.message)
    if (!existing) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const previousStatus = existing.status as MatterStatus
    if (previousStatus === status) {
      return NextResponse.json({ matterId, status, unchanged: true })
    }

    const holdReason =
      status === 'on_hold' && typeof body?.holdReason === 'string' && body.holdReason.trim()
        ? body.holdReason.trim()
        : null

    const { error: updateError } = await admin
      .from('matters')
      .update({ status, hold_reason: holdReason })
      .eq('id', matterId)

    if (updateError) throw new Error(updateError.message)

    const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null

    await admin.from('matter_activity').insert({
      matter_id: matterId,
      event_type: 'status_changed',
      title: `Matter ${matterStatusLabel(status).toLowerCase()}`,
      detail: `From ${matterStatusLabel(previousStatus)} to ${matterStatusLabel(status)}`,
      metadata: { from: previousStatus, to: status, hold_reason: holdReason },
      actor_id: userId,
      actor_email: user?.email ?? null,
      actor_name: actorName,
    })

    return NextResponse.json({ matterId, status, previousStatus })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
