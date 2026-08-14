import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AdminClient = SupabaseClient<Database>

/**
 * Is this contact on this matter?
 *
 * The authorization check behind every contact write reached through a matter
 * route. It used to be spelled `.eq('client_intake_id', intakeId)` appended to
 * the write itself — which scoped edits to the *household*, so once a client
 * has two matters, a request routed through one could edit a person the other
 * one owns. Scoping to the join is what actually confines a write to the matter
 * the caller is on.
 *
 * Returns the join row's `relationship_type` (authoritative for this matter) so
 * callers can apply per-relationship rules without a second read.
 */
export async function contactOnMatter(
  admin: AdminClient,
  matterId: string,
  contactId: string,
): Promise<{ onMatter: boolean; relationshipType: string | null }> {
  const { data, error } = await admin
    .from('matter_contacts')
    .select('relationship_type')
    .eq('matter_id', matterId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { onMatter: false, relationshipType: null }
  return {
    onMatter: true,
    relationshipType: (data as { relationship_type?: string | null }).relationship_type ?? null,
  }
}
