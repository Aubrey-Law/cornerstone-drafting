import { getAdminClient } from '@/lib/supabaseAdmin'
import type { PipelineMatter } from '@/types/database'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { fetchUnreviewedUploadCountsForMatters } from '@/lib/matter/unreviewedUploads'

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

  const matters = (data ?? []) as PipelineMatter[]
  try {
    const countsMap = await fetchUnreviewedUploadCountsForMatters(
      admin,
      matters.map(m => m.matter_id),
    )
    return {
      matters: matters.map(m => {
        const matterCounts = countsMap.get(m.matter_id) ?? { intake: 0, portal: 0, total: 0 }
        return {
          ...m,
          unreviewed_intake_upload_count: matterCounts.intake,
          unreviewed_portal_upload_count: matterCounts.portal,
          unreviewed_upload_count: matterCounts.total,
        }
      }),
      error: null,
    }
  } catch (countError) {
    console.error('fetchMattersList upload counts error:', countError)
    return { matters, error: null }
  }
}
