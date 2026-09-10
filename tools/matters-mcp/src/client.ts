import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@aubrey-law/db-types'

export type MattersClient = SupabaseClient<Database>

export interface MattersClientConfig {
  url: string
  serviceKey: string
}

/**
 * The environment this server needs, as a pure function of an environment
 * object so it can be tested without touching `process.env`.
 *
 * The service key is deliberate: this server's whole purpose is correcting
 * records, and it runs as an operator tool rather than on behalf of a signed-in
 * user. RLS is therefore bypassed — which is why the guardrails live in
 * `correct_matter` rather than in a policy.
 */
export function mattersClientConfig(env: Record<string, string | undefined>): MattersClientConfig {
  const url = present(env.SUPABASE_URL) ?? present(env.NEXT_PUBLIC_SUPABASE_URL)
  if (!url) throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set')

  const serviceKey = present(env.SUPABASE_SERVICE_ROLE_KEY)
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return { url, serviceKey }
}

/** A value that is set and not blank. A blank env var is the common failure. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function createMattersClient(config: MattersClientConfig): MattersClient {
  return createClient<Database>(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
