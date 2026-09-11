import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { StageGroup } from '@/types/database'
import type { MatterPageParams } from '@/lib/matters/pageParams'
import { pageRequest, type PageResult } from '@/lib/queries/page'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay } from '@/lib/phone'
import type { PipelineMatter } from '@/types/database'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { fetchUnreviewedUploadCountsForMatters } from '@/lib/matter/unreviewedUploads'
import {
  type MatterSortKey,
  type MatterTableFilters,
} from '@/lib/adminTables/matterTable'
import { toMatterExportRow, type MatterExportRow } from '@/lib/matters/exportRows'

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

/**
 * The matters list as export rows: the same set the page shows, narrowed by
 * the same filters.
 *
 * The list is filtered and sorted in the browser over every open matter, so
 * the export runs that same pure function here rather than restating the
 * search, the practice filter and the stage chips in SQL — one definition of
 * "the matters you are looking at", for the page and the assistant alike.
 */
export interface MatterExportPage {
  rows: MatterExportRow[]
  /** Matters matching the filters, before `limit` is applied. */
  total: number
  truncated: boolean
}

export const MATTER_EXPORT_MAX_ROWS = 2000
export const MATTER_EXPORT_DEFAULT_ROWS = 500

export function clampMatterExportLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return MATTER_EXPORT_DEFAULT_ROWS
  return Math.max(1, Math.min(MATTER_EXPORT_MAX_ROWS, Math.floor(numeric)))
}

export async function fetchMatterExportRows(
  filters: MatterTableFilters,
  options: { sort?: MatterSortKey; limit?: number; card?: 'attention'|'signing'|null } = {},
): Promise<MatterExportPage> {
  const limit = clampMatterExportLimit(options.limit ?? MATTER_EXPORT_DEFAULT_ROWS)
  const rows: MatterExportRow[] = []
  let total = 0
  for(let page=1;rows.length<limit;page++) {
    const result=await fetchMatterPage({page,pageSize:100,filters,sort:options.sort ?? 'client_asc',card:options.card ?? null,view:'table',groupPages:{early:1,active:1,work:1,done:1,closed:1}})
    total=result.total
    rows.push(...result.rows.slice(0,limit-rows.length).map(toMatterExportRow))
    if(page*100>=total || result.rows.length===0) break
  }
  return { rows,total,truncated:total>rows.length }
}

export type MatterPageResult = PageResult<MatterListRow> & {
  groups: Partial<Record<StageGroup,number>>
  columns: Partial<Record<StageGroup,number>>
  insights: { open:number; attention:number; signing:number; intakePending:number; unreviewed:number }
}
export async function fetchMatterPage(params:MatterPageParams):Promise<MatterPageResult> {
  const admin=getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
  const { data,error }=await admin.rpc('firm_matter_page_v1',{p_query:{
    ...pageRequest(params), search:params.filters.search,practice:params.filters.practice,stage:params.filters.stageGroup,
    sort:params.sort,card:params.card ?? '',view:params.view,groupPages:params.groupPages,
  }})
  if(error || !data) throw new Error('Matter list is temporarily unavailable. Please retry.')
  const page=data as unknown as MatterPageResult
  return {...page,rows:page.rows.map(row=>({...row,client_phone:formatPhoneDisplay(row.client_phone)||row.client_phone}))}
}
