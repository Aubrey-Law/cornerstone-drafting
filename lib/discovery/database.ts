import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@aubrey-law/db-types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { DiscoveryCall } from './contracts'
// Narrow typed extension until the additive migration is available to db:types:local.
type RowTable<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] }
type DiscoveryDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Tables' | 'Functions'> & {
  Tables: Database['public']['Tables'] & { discovery_calls: RowTable<DiscoveryCall>; discovery_call_amendments: RowTable<{ id: string; call_id: string; body: string; actor_id: string; created_at: string }> }
  Functions: Database['public']['Functions'] & {
    discovery_call_write: { Args: { p_lead_id: string; p_actor_id: string; p_operation: string; p_call_id?: string; p_revision?: number; p_answers?: Json; p_summary?: string; p_version_id?: string; p_amendment?: string }; Returns: Json }
    discovery_fact_snapshot: { Args: { p_lead_id: string }; Returns: Json }
    apply_discovery_facts: { Args: { p_lead_id: string; p_call_id: string; p_actor_id: string; p_changes: Json }; Returns: Json }
  }
} }
export const discoveryDb = () => getAdminClient() as unknown as SupabaseClient<DiscoveryDatabase>
