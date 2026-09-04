import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from './database'

/**
 * The service-role client. Bypasses row-level security, so it is server-only
 * and every call site is responsible for its own authorization check.
 *
 * Built on first use, not on import: this module is reachable from code Next
 * evaluates at build time, where the key is legitimately absent.
 */
let cached: SupabaseClient<WorkbenchDatabase> | null = null

function required(name: string): string {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(
      `${name} is not set, so the Workbench cannot reach Supabase. See apps/workbench/lib/env.ts.`,
    )
  }
  return value
}

export function getAdminClient(): SupabaseClient<WorkbenchDatabase> {
  if (cached) return cached
  // Refuse up front rather than building a client from `undefined!`. That one
  // fails later, inside a query, as an opaque fetch error that names nothing.
  cached = createClient<WorkbenchDatabase>(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
