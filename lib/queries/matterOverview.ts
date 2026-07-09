import { getAdminClient } from '@/lib/supabaseAdmin'
import type { MatterAgingHealth } from '@/lib/queries/pipelineAging'

export async function fetchMatterAgingHealth(matterId: string): Promise<MatterAgingHealth | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('v_matter_aging')
    .select('health, is_snoozed')
    .eq('id', matterId)
    .maybeSingle()

  if (error || !data) return null
  if (data.is_snoozed) return null
  const health = data.health as MatterAgingHealth | null
  return health === 'red' || health === 'amber' || health === 'green' ? health : null
}
