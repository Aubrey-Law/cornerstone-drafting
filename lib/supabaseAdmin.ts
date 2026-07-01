import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'scott@aubreylegal.com'

// Service-role client — bypasses RLS. Only use server-side.
// Initialized on first use so the module can be imported at build time
// without SUPABASE_SERVICE_ROLE_KEY being present. Memoized so we don't
// pay the createClient cost on every helper call within a request.
let _adminClient: SupabaseClient<Database> | null = null
export function getAdminClient(): SupabaseClient<Database> {
  if (_adminClient) return _adminClient
  _adminClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  return _adminClient
}
