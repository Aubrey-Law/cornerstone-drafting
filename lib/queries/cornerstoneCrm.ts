import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay } from '@/lib/phone'

type CrmPersonStageRow = {
  id: string
  name: string | null
  slug: string | null
}

export type CrmStageRow = {
  id: string
  name: string
  slug: string
  sort_order: number
  is_active: boolean
  is_closed: boolean
  is_won: boolean
}

type CrmPersonRow = {
  id: string
  source_system: string
  /** Constrained by `cornerstone_crm_people_person_kind_check` to these three. */
  person_kind: 'primary' | 'related' | 'standalone'
  lead_id: string | null
  cornerstone_matter_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  mobile_phone: string | null
  company_name: string | null
  job_title: string | null
  city: string | null
  state: string | null
  country: string | null
  lead_source: string | null
  referral_source: string | null
  lifecycle_status: string | null
  owner_user_id: string | null
  assigned_to_user_id: string | null
  next_follow_up_at: string | null
  last_engagement_at: string | null
  stage_id: string | null
  stage_entered_at: string | null
  created_at: string
  updated_at: string
}

type CrmLeadRow = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type CrmMatterRow = {
  id: string
  matter_number: string | null
}

export interface CrmPeopleRow {
  id: string
  sourceSystem: CrmPersonRow['source_system']
  /**
   * `primary` is the lead or client themself; `related` is a spouse, child or
   * fiduciary synced from a matter contact, and `standalone` a contact with no
   * matter. Only a primary person can move through the pipeline, so the funnel
   * metrics count those and nothing else.
   */
  personKind: CrmPersonRow['person_kind']
  name: string
  email: string | null
  phone: string | null
  mobilePhone: string | null
  company: string | null
  jobTitle: string | null
  city: string | null
  state: string | null
  country: string | null
  leadSource: string | null
  referralSource: string | null
  lifecycleStatus: string | null
  ownerUserId: string | null
  assignedToUserId: string | null
  nextFollowUpAt: string | null
  lastEngagementAt: string | null
  stageId: string | null
  stageName: string | null
  stageSlug: string | null
  stageEnteredAt: string | null
  sourceRecordId: string | null
  sourceRecordHref: string | null
  sourceRecordLabel: string | null
  createdAt: string
  updatedAt: string
}

export interface CrmImportSummary {
  inserted: number
  updated: number
  skipped: number
  stageName: string | null
}

const CRMCACHE_MAX = 1000

function resolveName(person: CrmPersonRow): string {
  const fullName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
  if (fullName) return fullName
  if (person.company_name) return person.company_name
  return 'Contact'
}

function mapById<T extends { id: string }>(rows: T[] | null) {
  const map = new Map<string, T>()
  for (const row of rows ?? []) map.set(row.id, row)
  return map
}

function uniqueValues(rows: string[] | undefined): string[] {
  if (!rows?.length) return []
  return [...new Set(rows.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

export async function fetchCrmStages(): Promise<{ stages: CrmStageRow[]; error: string | null }> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('cornerstone_crm_stages')
    .select('id, name, slug, sort_order, is_active, is_closed, is_won')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) return { stages: [], error: error.message }
  return { stages: (data as CrmStageRow[]) ?? [], error: null }
}

/**
 * Just the columns the dashboard counts by. The full row carries three joins
 * and every contact field, which is why reading it was capped at 500 — and the
 * cap was what turned the dashboard's totals into a sample.
 */
export interface CrmDashboardPersonRow {
  personKind: CrmPersonRow['person_kind']
  lifecycleStatus: string | null
  stageId: string | null
  leadSource: string | null
  referralSource: string | null
  nextFollowUpAt: string | null
  createdAt: string
}

/** One PostgREST request returns at most this many rows, so the read pages. */
const CRM_PAGE_SIZE = 1000

/**
 * A ceiling on the paged read, so a runaway contact base cannot turn the
 * dashboard into an unbounded query. Reaching it is reported rather than
 * hidden — that was the whole complaint about the 500-row cap.
 */
export const CRM_DASHBOARD_MAX_PEOPLE = 25_000

export async function fetchCrmDashboardPeople(): Promise<{
  people: CrmDashboardPersonRow[]
  truncated: boolean
  error: string | null
}> {
  const admin = getAdminClient()
  const people: CrmDashboardPersonRow[] = []
  let total: number | null = null

  let from = 0
  while (from < CRM_DASHBOARD_MAX_PEOPLE) {
    const to = Math.min(from + CRM_PAGE_SIZE, CRM_DASHBOARD_MAX_PEOPLE) - 1
    const columns =
      'person_kind, lifecycle_status, stage_id, lead_source, referral_source, next_follow_up_at, created_at'
    const query = from === 0
      // The exact count comes back with the first page, so the loop knows how
      // many rows it is chasing rather than inferring it from a short page. A
      // PostgREST instance can cap rows per request below what was asked for,
      // and inferring from that would stop early and call the result whole.
      ? admin.from('cornerstone_crm_people').select(columns, { count: 'exact' })
      : admin.from('cornerstone_crm_people').select(columns)

    const { data, error, count } = await query
      // Ordered so the pages partition the table rather than overlapping it;
      // `created_at` alone is not unique, so `id` breaks the ties.
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
    if (error) return { people: [], truncated: false, error: error.message }
    if (typeof count === 'number') total = count

    const rows = (data ?? []) as unknown as Array<{
      person_kind: CrmPersonRow['person_kind']
      lifecycle_status: string | null
      stage_id: string | null
      lead_source: string | null
      referral_source: string | null
      next_follow_up_at: string | null
      created_at: string
    }>
    for (const row of rows) {
      people.push({
        personKind: row.person_kind,
        lifecycleStatus: row.lifecycle_status,
        stageId: row.stage_id,
        leadSource: row.lead_source,
        referralSource: row.referral_source,
        nextFollowUpAt: row.next_follow_up_at,
        createdAt: row.created_at,
      })
    }

    // An empty page is the end of the table whatever the count claimed; without
    // this a stale or missing count would spin the loop to the ceiling.
    if (rows.length === 0) break
    // Advanced by what came back rather than by what was asked for, so a
    // server-side row cap makes the read slower, not incomplete.
    from += rows.length
    if (total !== null && people.length >= Math.min(total, CRM_DASHBOARD_MAX_PEOPLE)) break
  }

  const truncated = total !== null
    ? total > CRM_DASHBOARD_MAX_PEOPLE
    : people.length >= CRM_DASHBOARD_MAX_PEOPLE
  return { people, truncated, error: null }
}

export async function fetchCrmPeople(
  limit = 200,
  options: { orderBy?: 'updated_at' | 'created_at' } = {},
): Promise<{ people: CrmPeopleRow[]; error: string | null }> {
  const admin = getAdminClient()
  const { data: rawPeople, error: peopleError } = await admin
    .from('cornerstone_crm_people')
    .select('*')
    .order(options.orderBy ?? 'updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, CRMCACHE_MAX)))

  if (peopleError) return { people: [], error: peopleError.message }
  const people = rawPeople as CrmPersonRow[]
  if (!people.length) return { people: [], error: null }

  const stageIds = uniqueValues(people.map(row => row.stage_id).filter((value): value is string => Boolean(value)))
  const leadIds = uniqueValues(people.map(row => row.lead_id).filter((value): value is string => Boolean(value)))
  const matterIds = uniqueValues(people
    .map(row => row.cornerstone_matter_id)
    .filter((value): value is string => Boolean(value)))

  const [
    stagesResult,
    leadsResult,
    mattersResult,
  ] = await Promise.all([
    stageIds.length
      ? admin.from('cornerstone_crm_stages').select('id, name, slug').in('id', stageIds)
      : Promise.resolve({ data: [] as CrmPersonStageRow[], error: null }),
    leadIds.length
      ? admin.from('client_intake').select('id, full_name, first_name, last_name, email').in('id', leadIds)
      : Promise.resolve({ data: [] as CrmLeadRow[], error: null }),
    matterIds.length
      ? admin.from('matters').select('id, matter_number').in('id', matterIds)
      : Promise.resolve({ data: [] as CrmMatterRow[], error: null }),
  ])

  if (stagesResult.error || leadsResult.error || mattersResult.error) {
    return {
      people: [],
      error: [stagesResult.error?.message, leadsResult.error?.message, mattersResult.error?.message]
        .filter(Boolean)
        .join(', ') || 'Failed to load Cornerstone CRM references',
    }
  }

  const stageById = mapById(stagesResult.data as CrmPersonStageRow[])
  const leadById = mapById(leadsResult.data as CrmLeadRow[])
  const matterById = mapById(mattersResult.data as CrmMatterRow[])

  return {
    people: people.map(person => {
      const lead = person.lead_id ? leadById.get(person.lead_id) : null
      const matter = person.cornerstone_matter_id ? matterById.get(person.cornerstone_matter_id) : null
      const sourceHref = person.lead_id
        ? `/admin/crm/opportunities/${person.lead_id}`
        : person.cornerstone_matter_id
          ? `/admin/matters/${person.cornerstone_matter_id}`
          : null
      const sourceLabel = lead
        ? lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.email
        : matter
          ? `Matter ${matter.matter_number ?? person.cornerstone_matter_id}`
          : null
      const stage = person.stage_id ? stageById.get(person.stage_id) : null

      return {
        id: person.id,
        sourceSystem: person.source_system,
        personKind: person.person_kind,
        name: resolveName(person),
        email: person.email,
        phone: person.phone ? formatPhoneDisplay(person.phone) : null,
        mobilePhone: person.mobile_phone ? formatPhoneDisplay(person.mobile_phone) : null,
        company: person.company_name,
        jobTitle: person.job_title,
        city: person.city,
        state: person.state,
        country: person.country,
        leadSource: person.lead_source,
        referralSource: person.referral_source,
        lifecycleStatus: person.lifecycle_status,
        ownerUserId: person.owner_user_id,
        assignedToUserId: person.assigned_to_user_id,
        nextFollowUpAt: person.next_follow_up_at,
        lastEngagementAt: person.last_engagement_at,
        stageId: person.stage_id,
        stageName: stage?.name ?? null,
        stageSlug: stage?.slug ?? null,
        stageEnteredAt: person.stage_entered_at ?? null,
        sourceRecordId: person.lead_id ?? person.cornerstone_matter_id,
        sourceRecordHref: sourceHref,
        sourceRecordLabel: sourceLabel,
        createdAt: person.created_at,
        updatedAt: person.updated_at,
      }
    }),
    error: null,
  }
}
