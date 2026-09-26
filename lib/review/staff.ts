import 'server-only'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'

/**
 * For a review page's server component: the signed-in staff user, or a
 * redirect to login. A layout can render concurrently with its page, so the
 * page authorizes before its service-role queries even though the admin
 * layout has its own gate (as `app/admin/drafting/page.tsx` does).
 */
export async function requireStaffPage(): Promise<{ userId: string }> {
  const user = await getCachedClaims()
  if (!user) redirect('/auth/login')
  const role = await getCachedUserRole(user.id)
  if (role !== 'attorney' && role !== 'admin') redirect('/auth/login')
  return { userId: user.id }
}

/** The service-role client, typed with the generated schema the review code is written against. */
export function reviewClient(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}
