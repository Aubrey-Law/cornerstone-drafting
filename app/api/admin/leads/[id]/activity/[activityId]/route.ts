import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { canDeleteLeadActivity } from '@/lib/leads/activity'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; activityId: string }> }) {
  const { err, userId } = await requireAdmin(req); if (err) return err
  const { id, activityId } = await params; const admin = getAdminClient()
  const [{ data: row }, { data: profile }] = await Promise.all([
    admin.from('lead_activity').select('id,event_type,actor_id').eq('id', activityId).eq('lead_id', id).maybeSingle(),
    admin.from('users').select('role').eq('id', userId).maybeSingle(),
  ])
  if (!row) return Response.json({ error: 'Activity not found' }, { status: 404 })
  if (!canDeleteLeadActivity({ eventType: row.event_type, actorId: row.actor_id }, { id: userId!, role: profile?.role ?? '' })) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const { error } = await admin.from('lead_activity').delete().eq('id', activityId)
  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true })
}
