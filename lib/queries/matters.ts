import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay } from '@/lib/phone'
import type { PipelineMatter } from '@/types/database'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { fetchUnreviewedUploadCountsForMatters } from '@/lib/matter/unreviewedUploads'

export type MatterListRow = PipelineMatter & {
  matter_number: string | null
}

export async function fetchMattersList(): Promise<{
  matters: MatterListRow[]
  error: string | null
}> {
  const admin = getAdminClient()
  // Matters is the retained-client workspace. Prospective clients stay in CRM
  // Opportunities even though both lifecycles share the underlying matters row.
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
  const matterIds = matters.map(m => m.matter_id)

  const matterNumbersRes = matterIds.length
    ? await admin.from('matters').select('id, matter_number').in('id', matterIds)
    : { data: [] as { id: string; matter_number: string | null }[], error: null }

  if (matterNumbersRes.error) {
    console.error('fetchMattersList matter numbers error:', matterNumbersRes.error)
  }

  const matterNumberById = new Map(
    (matterNumbersRes.data ?? []).map(row => [row.id, row.matter_number as string | null]),
  )

  const enrich = (m: PipelineMatter): MatterListRow => ({
    ...m,
    matter_number: matterNumberById.get(m.matter_id) ?? null,
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
