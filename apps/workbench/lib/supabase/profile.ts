import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureUserProfile, type ProfileStore } from '@/lib/auth/profile'
import type { WorkbenchDatabase } from './database'
import { readUserRole } from './roles'

/** The two queries behind profile bootstrap, against a concretely typed client. */
export function profileStore(
  client: SupabaseClient<WorkbenchDatabase>,
  userId: string,
): ProfileStore {
  return {
    readRole: () => readUserRole(client, userId),
    createProfile: async (fullName) => {
      const { data, error } = await client.rpc('ensure_user_profile', {
        p_display_name: fullName,
      })
      if (error) return { ok: false, role: null }
      return { ok: true, role: typeof data === 'string' && data.length > 0 ? data : null }
    },
  }
}

/** What the sign-in callback calls: bootstrap this user's profile, return their role. */
export function ensureProfileForUser(
  client: SupabaseClient<WorkbenchDatabase>,
  user: { id: string; fullName: string | null },
): Promise<string | null> {
  return ensureUserProfile(profileStore(client, user.id), { fullName: user.fullName })
}
