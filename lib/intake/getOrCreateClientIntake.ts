import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'

type ClientIntakeRow = Record<string, unknown>

export async function findClientIntakeForUser(
  supabase: SupabaseClient,
  userId: string,
  preferredId?: string | null,
): Promise<ClientIntakeRow | null> {
  // One person can hold several questionnaires (their own and, say, a child's
  // College Prep they are filling in). A requested one is honoured only when
  // the caller owns it; otherwise the oldest row stays canonical.
  if (preferredId) {
    const { data: preferred } = await supabase
      .from('client_intake')
      .select('*')
      .eq('id', preferredId)
      .or(`user_id.eq.${userId},client_user_id.eq.${userId}`)
      .limit(1)
    if (preferred?.[0]) return preferred[0] as ClientIntakeRow
  }

  const { data } = await supabase
    .from('client_intake')
    .select('*')
    .or(`user_id.eq.${userId},client_user_id.eq.${userId}`)
    .order('created_at', { ascending: true })
    .limit(1)

  return (data?.[0] as ClientIntakeRow | undefined) ?? null
}

async function linkInvitedIntakeByEmail(user: User): Promise<ClientIntakeRow | null> {
  const email = user.email?.trim().toLowerCase()
  if (!email) return null

  try {
    const admin = getAdminClient()
    const { data: rows, error } = await admin
      .from('client_intake')
      .select('*')
      .ilike('email', email)
      .is('client_user_id', null)
      .order('created_at', { ascending: true })
      .limit(1)

    if (error || !rows?.length) return null

    const intake = rows[0] as ClientIntakeRow
    const { data: updated, error: updateError } = await admin
      .from('client_intake')
      .update({
        client_user_id: user.id,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', intake.id as string)
      .select('*')
      .single()

    if (updateError || !updated) return intake
    return updated as ClientIntakeRow
  } catch (error) {
    console.error('[intake] invite email link failed:', error)
    return null
  }
}

export async function getOrCreateClientIntakeForUser(
  supabase: SupabaseClient,
  user: User,
  preferredId?: string | null,
): Promise<ClientIntakeRow> {
  const owned = await findClientIntakeForUser(supabase, user.id, preferredId)
  if (owned) return owned

  const linked = await linkInvitedIntakeByEmail(user)
  if (linked) return linked

  // The service role, not `supabase`: clients have no INSERT policy on this
  // table any more (see
  // 20261209000000_client_intake_writes_service_role_only.sql — it is the
  // firm's lead table as well as the questionnaire). `user_id` comes from the
  // authenticated session, so the row it creates is still the caller's own,
  // and the SELECT above — which did run under RLS — is what established that
  // they have none yet.
  const { data: created, error } = await getAdminClient()
    .from('client_intake')
    .insert({
      user_id: user.id,
      email: user.email,
      status: 'draft',
      current_step: 'personal',
      state: 'MA',
      is_us_citizen: true,
    })
    .select('*')
    .single()

  if (error || !created) throw new Error('Failed to create intake record')
  return created as ClientIntakeRow
}
