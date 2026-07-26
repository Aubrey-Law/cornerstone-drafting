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
  // `.maybeSingle()` errors when a user has more than one intake row or more
  // than one hired matter — both legitimate states (re-invite, second
  // engagement). That error surfaced as "no matter", so every portal page told
  // the client their matter was still being set up and showed no documents or
  // messages. Ordering matches findClientIntakeForUser.
  const { data: intakes, error: intakeError } = await supabase
    .from('client_intake')
    .select('id')
    .or(`user_id.eq.${userId},client_user_id.eq.${userId}`)
    .order('created_at', { ascending: true })
    .limit(1)

  if (intakeError) throw new Error(intakeError.message)
  const intake = intakes?.[0]
  if (!intake) return null

  const admin = getAdminClient()
  const { data: matters, error: matterError } = await admin
    .from('matters')
    .select('id, status, stage')
    .eq('client_intake_id', intake.id)
    .eq('relationship_status', 'hired')
    .order('created_at', { ascending: true })
    .limit(1)

  if (matterError) throw new Error(matterError.message)
  const matter = matters?.[0]
  if (!matter) return null
  return {
    id: matter.id as string,
    status: (matter.status as string | null) ?? null,
    stage: (matter.stage as MatterStage | null) ?? null,
  }
}
