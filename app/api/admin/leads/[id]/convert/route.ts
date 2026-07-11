import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'

/**
 * POST /api/admin/leads/[id]/convert — manually convert a lead into a matter
 * (the e-sign webhook does this automatically when the engagement is signed).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err, userId } = await requireAdmin(req)
  if (err) return err
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: intakeId } = await params
  const admin = getAdminClient()
  const result = await createMatterFromIntake(admin, intakeId, { actorId: userId ?? null })
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
  return Response.json({ matterId: result.matterId, matterNumber: result.matterNumber })
}
