import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { MatterStage } from '@/types/database'

export interface PortalMatter {
  id: string
  status: string | null
  stage: MatterStage | null
}

/**
 * Canonical matter lookup for portal users.
 *
 * Handles both auth paths (user_id from session, client_user_id from magic link).
 * The intake read is RLS-gated by user_id/client_user_id and proves ownership;
 * the matter is then looked up by client_intake_id via the admin client — the
 * ownership invariant is already established by the intake read.
 */
export async function getMatterForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<PortalMatter | null> {
  const { data: intake } = await supabase
    .from('client_intake')
    .select('id')
    .or(`user_id.eq.${userId},client_user_id.eq.${userId}`)
    .maybeSingle()

  if (!intake) return null

  const admin = getAdminClient()
  const { data: matter } = await admin
    .from('matters')
    .select('id, status, stage')
    .eq('client_intake_id', intake.id)
    .eq('relationship_status', 'hired')
    .maybeSingle()

  if (!matter) return null
  return {
    id: matter.id as string,
    status: (matter.status as string | null) ?? null,
    stage: (matter.stage as MatterStage | null) ?? null,
  }
}
