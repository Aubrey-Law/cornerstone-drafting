import type { SupabaseClient, User } from '@supabase/supabase-js'

export const FIRM_EMAIL_DOMAIN = 'aubreylegal.com'

export function isFirmEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${FIRM_EMAIL_DOMAIN}`)
}

/** Ensure `public.users` exists for an authenticated auth user (greenfield bootstrap). */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  user: Pick<User, 'id' | 'email' | 'user_metadata'>,
): Promise<string | null> {
  const { data: existingUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (existingUser?.role) return existingUser.role

  // The role must be derived from the verified email server-side. This RPC is
  // SECURITY DEFINER and reads auth.users, so a caller cannot choose their own
  // role — RLS forbids inserting anything but 'client' directly.
  const { data: role, error } = await supabase.rpc('ensure_user_profile', {
    p_display_name: (user.user_metadata?.full_name as string | undefined) ?? null,
  })

  if (error) {
    const { data: retry } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    return retry?.role ?? null
  }

  return (role as string | null) ?? null
}
