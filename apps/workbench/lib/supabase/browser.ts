import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from './database'

/**
 * The browser client, sharing one instance per tab so that a session refresh
 * in one component is seen by all of them.
 */
let cached: SupabaseClient<WorkbenchDatabase> | null = null

export function getBrowserSupabase(): SupabaseClient<WorkbenchDatabase> {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for the browser client.',
    )
  }
  cached = createBrowserClient<WorkbenchDatabase>(url, anonKey)
  return cached
}
