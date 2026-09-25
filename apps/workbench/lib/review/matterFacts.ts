import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { deriveMatterFacts, type MatterFacts } from '@aubrey-law/citations/review/conditions'

/**
 * The facts a review's rule conditions are tested against, from the matter's
 * current design sheet — pinned on the run when it opens (`resolved_inputs`),
 * so a retry an hour later skips exactly the rules the run first skipped.
 *
 * The select is a literal rather than the package's `MATTER_FACT_COLUMNS` so
 * `query-columns.test.ts` can check it against the schema; the two must name
 * the same columns.
 *
 * Null when the matter has no design sheet, which means every rule runs.
 */
export async function loadMatterFacts(
  client: SupabaseClient<WorkbenchDatabase>,
  matterId: string,
): Promise<MatterFacts | null> {
  const { data, error } = await client
    .from('design_sheets')
    .select('marital_status, is_joint, children, plan_type, assets')
    .eq('matter_id', matterId)
    // The highest version is the current sheet, as in `loadSourceRows`.
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Could not load the design sheet: ${error.message}`)
  return data ? deriveMatterFacts(data as Record<string, unknown>) : null
}
