import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay } from '@/lib/phone'
import type { PipelineMatter } from '@/types/database'
import { PIPELINE_MATTER_ALL_COLUMNS } from '@/lib/queries/matterCore'
import { fetchUnreviewedUploadCountsForMatters } from '@/lib/matter/unreviewedUploads'

export type MatterListRow = PipelineMatter & {
  matter_number: string | null
  /** lead | hired | lost | declined — the list shows the whole pipeline. */
  relationship_status: string
}

export async function fetchMattersList(): Promise<{
  matters: MatterListRow[]
  error: string | null
}> {
  const admin = getAdminClient()
  // The consolidated view: leads and hired matters in one list, so a lead is a
  // matter here rather than living on its own page.
  const { data, error } = await admin
    .from('v_matter_pipeline_all')
    .select(PIPELINE_MATTER_ALL_COLUMNS)
    .neq('status', 'archived')
    .order('matter_created', { ascending: false })

  if (error) {
    console.error('fetchMattersList error:', error)
    return { matters: [], error: error.message }
  }

  // matter_number now comes from the view, so the second round trip is gone.
  const matters = (data ?? []) as unknown as MatterListRow[]
  const matterIds = matters.map(m => m.matter_id)

  const enrich = (m: MatterListRow): MatterListRow => ({
    ...m,
    client_phone: formatPhoneDisplay(m.client_phone) || m.client_phone,
  })

  try {
    const countsMap = await fetchUnreviewedUploadCountsForMatters(admin, matterIds)
    return {
      matters: matters.map(m => {
        const matterCounts = countsMap.get(m.matter_id) ?? { intake: 0, portal: 0, total: 0 }
        return {
          ...enrich(m),
          unreviewed_intake_upload_count: matterCounts.intake,
          unreviewed_portal_upload_count: matterCounts.portal,
          unreviewed_upload_count: matterCounts.total,
        }
      }),
      error: null,
    }
  } catch (countError) {
    console.error('fetchMattersList upload counts error:', countError)
    return { matters: matters.map(enrich), error: null }
  }
}
