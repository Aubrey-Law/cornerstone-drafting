import { getAdminClient } from '@/lib/supabaseAdmin'
import type { PipelineMatter } from '@/types/database'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'

export async function fetchMattersList(): Promise<{
  matters: PipelineMatter[]
  error: string | null
}> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('v_matter_pipeline')
    .select(PIPELINE_MATTER_COLUMNS)
    .neq('status', 'archived')
    .order('matter_created', { ascending: false })

  if (error) {
    console.error('fetchMattersList error:', error)
    return { matters: [], error: error.message }
  }

  return { matters: (data ?? []) as PipelineMatter[], error: null }
}
