import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'
import type { LeadListRow } from '@/lib/leads/viewTypes'
import type { LeadSortKey } from '@/lib/adminTables/leadTable'
import {
  clampLeadExportLimit,
  LEAD_EXPORT_DEFAULT_ROWS,
  toLeadExportRow,
  type LeadExportRow,
  type LeadExportSourceRow,
} from '@/lib/leads/exportRows'
import {
  buildLeadSearchFilter,
  clampShow,
  EMPTY_LEAD_LIST_SUMMARY,
  type LeadListParams,
  type LeadListSummary,
} from '@/lib/leads/listParams'

/**
 * The leads list, ranked and paged in the database.
 *
 * The page used to load 200 leads and then filter, sort and score them in the
 * browser. Every one of those now happens over the whole pipeline in
 * `v_lead_list` (20261014000000), so a page is the top N of the real ordering
 * rather than the top N of whatever came back.
 */

export interface LeadListPage {
  rows: LeadListRow[]
  /** Rows matching the current filters, before paging. */
  total: number
  hasMore: boolean
  summary: LeadListSummary
  error: string | null
}

const LEAD_SELECT =
  'id, full_name, first_name, middle_name, last_name, preferred_name, email, phone, date_of_birth, '
  + 'address_line1, address_line2, city, state, zip, county, marital_status, qualification_notes, '
  + 'has_minor_children, lead_source, practice_area, status, lead_status, matter_id, intake_sent_at, '
  + 'intake_completed_at, engagement_status, engagement_sent_at, engagement_signed_at, '
  + 'engagement_fee_quoted, billing_type, lead_urgency, taxable_estate, '
  + 'lead_next_action_snoozed_until, user_id, client_user_id, created_at, updated_at, '
  + 'last_activity_at, next_appointment_at, score'

/** How each sort key orders in SQL. Nulls sort last, as `compareNullable` does. */
const SORT_ORDER: Record<LeadSortKey, { column: string; ascending: boolean }> = {
  newest: { column: 'created_at', ascending: false },
  oldest: { column: 'created_at', ascending: true },
  name_asc: { column: 'display_name', ascending: true },
  name_desc: { column: 'display_name', ascending: false },
  fee_desc: { column: 'engagement_fee_quoted', ascending: false },
  last_activity: { column: 'last_activity_at', ascending: false },
  score_desc: { column: 'score', ascending: false },
}

function selectLeads(columns: string, withCount: boolean) {
  const admin = getAdminClient()
  return withCount
    ? admin.from('v_lead_list').select(columns, { count: 'exact' })
    : admin.from('v_lead_list').select(columns)
}

type LeadQuery = ReturnType<typeof selectLeads>

/**
 * Everything except paging and ordering.
 *
 * Exported so the CSV export reads exactly the selection the reader is looking
 * at: one filter vocabulary, not two that drift apart.
 */
export function applyLeadListFilters(query: LeadQuery, params: LeadListParams): LeadQuery {
  let next = query
  if (params.status === 'open') next = next.eq('lead_status', 'lead')
  else if (params.status !== 'all') next = next.eq('lead_status', params.status)

  // The cards narrow open leads, which is what they count.
  if (params.card === 'attention') next = next.eq('is_open', true).eq('needs_attention', true)
  if (params.card === 'agreements') next = next.eq('is_open', true).eq('has_pending_agreement', true)

  if (params.practice && params.practice !== 'all') {
    next = next.eq('practice_area', normalizePracticeArea(params.practice))
  }

  // `intake_complete` and `engagement_pending` are resolved in the view: both
  // read a status column that is usually null, and a PostgREST `neq` drops
  // nulls, so expressed here they would exclude most of what they should match.
  switch (params.progress) {
    case 'intake_not_sent':
      next = next.eq('intake_complete', false).is('intake_sent_at', null)
      break
    case 'intake_pending':
      next = next.eq('intake_complete', false).not('intake_sent_at', 'is', null)
      break
    case 'intake_complete':
      next = next.eq('intake_complete', true)
      break
    case 'engagement_pending':
      next = next.eq('engagement_pending', true)
      break
    case 'engagement_signed':
      next = next.eq('engagement_status', 'signed')
      break
    default:
      break
  }

  const search = buildLeadSearchFilter(params.search)
  if (search) next = next.or(search)
  return next
}

export async function fetchLeadListPage(params: LeadListParams): Promise<LeadListPage> {
  const show = clampShow(params.show)
  const order = SORT_ORDER[params.sort] ?? SORT_ORDER.newest

  const [result, summary] = await Promise.all([applyLeadListFilters(selectLeads(LEAD_SELECT, true), params)
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    // A stable tiebreak, so two leads with the same score or fee do not swap
    // places between one page and the next.
    .order('id', { ascending: true })
    .range(0, show - 1), fetchLeadListSummary()])
  const { data, error, count } = result

  if (error) {
    return { rows: [], total: 0, hasMore: false, summary: EMPTY_LEAD_LIST_SUMMARY, error: error.message }
  }

  const rows = (data ?? []) as unknown as LeadListRow[]
  const total = count ?? rows.length
  return { rows, total, hasMore: total > rows.length, summary, error: null }
}

/**
 * The tab counts and insight cards, over the whole pipeline.
 *
 * Deliberately not narrowed by the current filters: the cards are how the
 * reader sees what the filters and the page boundary are hiding, and the tab
 * counts have always reported the pipeline rather than the selection. Only the
 * flags and the fee are read, so the whole set stays cheap.
 */
export async function fetchLeadListSummary(): Promise<LeadListSummary> {
  const admin = getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
  const { data, error } = await admin.rpc('firm_lead_summary_v1')
  if (error || !data) throw new Error('Lead summary is temporarily unavailable')
  return data as unknown as LeadListSummary
}

/**
 * The contact list behind a lead export: name, email and phone for every lead
 * matching the current filters, up to `limit`.
 *
 * Filtered and ordered in the database like the list itself, so an export is
 * the selection the reader sees rather than whatever a page happened to hold.
 */
export interface LeadExportPage {
  rows: LeadExportRow[]
  /** Leads matching the filters, before `limit` is applied. */
  total: number
  /** True when the cap kept rows out of `rows`. */
  truncated: boolean
}

const LEAD_EXPORT_SELECT = 'id, display_name, full_name, first_name, last_name, email, phone'

export async function fetchLeadExportRows(
  params: LeadListParams,
  options: { limit?: number } = {},
): Promise<LeadExportPage> {
  const limit = clampLeadExportLimit(options.limit ?? LEAD_EXPORT_DEFAULT_ROWS)
  const order = SORT_ORDER[params.sort] ?? SORT_ORDER.name_asc

  const { data, error, count } = await applyLeadListFilters(selectLeads(LEAD_EXPORT_SELECT, true), params)
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(0, limit - 1)

  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as unknown as LeadExportSourceRow[]).map(toLeadExportRow)
  const total = count ?? rows.length
  return { rows, total, truncated: total > rows.length }
}
