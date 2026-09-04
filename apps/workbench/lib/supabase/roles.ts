import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from './database'

/**
 * The one query behind the role fallback.
 *
 * Returns null on error rather than throwing: the caller is deciding whether to
 * admit a request, and "role unknown" is the answer that denies. A thrown error
 * here would become a 500 on a path that should simply refuse.
 */
export async function readUserRole(
  client: SupabaseClient<WorkbenchDatabase>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client.from('users').select('role').eq('id', userId).maybeSingle()
  if (error) return null
  return data?.role ?? null
}
