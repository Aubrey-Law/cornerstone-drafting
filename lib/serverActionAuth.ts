import { createServerSupabase } from './supabaseServer'
import { getAdminClient } from './supabaseAdmin'

export async function requireAdminServerAction(): Promise<string> {
  const supabase = await createServerSupabase()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Unauthorized')

  const { data: profile } = await getAdminClient()
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['attorney', 'admin'].includes(profile.role)) {
    throw new Error('Forbidden')
  }
  return user.id
}
