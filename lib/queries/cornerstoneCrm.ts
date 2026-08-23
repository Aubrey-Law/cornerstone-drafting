import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay } from '@/lib/phone'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAMPAIGN_LIFECYCLE_STATUSES = [
  'new',
  'contacted',
  'nurture',
  'qualified',
  'working',
  'converted',
  'closed_lost',
] as const
const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'] as const
const CAMPAIGN_TYPES = ['newsletter', 'nurture'] as const

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
  campaign_opt_out: boolean | null
  twenty_contact_id: string | null
  sync_state: string | null
  last_synced_at: string | null
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

export type CrmPeopleFilter = {
  search: string
  lifecycle: 'all' | 'new' | 'contacted' | 'nurture' | 'qualified' | 'working' | 'converted' | 'closed_lost'
}

export type CrmCampaignType = (typeof CAMPAIGN_TYPES)[number]
export type CrmCampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export interface CrmCampaignAudienceRules {
  lifecycleStatuses: CrmPeopleFilter['lifecycle'][]
  onlyWithEmail: boolean
  includeOptedOut: boolean
  search: string
  stageIds: string[]
}

export interface CrmCampaignRecipientCounts {
  total: number
  queued: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  failed: number
  complaint: number
  unsubscribed: number
}

export interface CrmCampaignListItem {
  id: string
  name: string
  type: CrmCampaignType
  status: CrmCampaignStatus
  audienceRules: CrmCampaignAudienceRules
  emailProvider: string
  subject: string | null
  bodyText: string | null
  bodyHtml: string | null
  providerTemplateId: string | null
  sendScheduleCronOrDate: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
  recipientCounts: CrmCampaignRecipientCounts
}

interface CrmCampaignDbRow {
  id: string
  name: string
  type: CrmCampaignType
  status: CrmCampaignStatus
  audience_rules: Record<string, unknown> | null
  email_provider: string
  provider_template_id: string | null
  send_schedule_cron_or_date: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
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
  campaignOptOut: boolean | null
  syncState: CrmPersonRow['sync_state']
  stageId: string | null
  stageName: string | null
  stageSlug: string | null
  stageEnteredAt: string | null
  twentyContactId: string | null
  sourceRecordId: string | null
  sourceRecordHref: string | null
  sourceRecordLabel: string | null
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CrmImportSummary {
  inserted: number
  updated: number
  skipped: number
  stageName: string | null
}

const LIFECYCLE_LABEL: Record<CrmPeopleFilter['lifecycle'], string> = {
  all: 'All',
  new: 'New Inquiry',
  contacted: 'Contacted',
  nurture: 'Nurture',
  qualified: 'Qualified',
  working: 'Working',
  converted: 'Converted',
  closed_lost: 'Closed / Lost',
}

const CAMPAIGN_RECIPIENT_STATUS_MAP: Readonly<Record<string, keyof CrmCampaignRecipientCounts>> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  opened: 'opened',
  clicked: 'clicked',
  bounced: 'bounced',
  failed: 'failed',
  complaint: 'complaint',
  unsubscribed: 'unsubscribed',
}

function emptyCampaignRecipientCounts(): CrmCampaignRecipientCounts {
  return {
    total: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
    complaint: 0,
    unsubscribed: 0,
  }
}

function clampCampaignLifecycleStatuses(raw: unknown): CrmPeopleFilter['lifecycle'][] {
  if (!Array.isArray(raw)) return [...CAMPAIGN_LIFECYCLE_STATUSES]
  const normalized = raw
    .map(item => (typeof item === 'string' ? item.toLowerCase().trim() : ''))
    .filter((item): item is Exclude<CrmPeopleFilter['lifecycle'], 'all'> =>
      CAMPAIGN_LIFECYCLE_STATUSES.includes(item as (typeof CAMPAIGN_LIFECYCLE_STATUSES)[number]),
    )
  const distinct = [...new Set(normalized)]
  return distinct.length > 0 ? distinct : [...CAMPAIGN_LIFECYCLE_STATUSES]
}

function normalizeStageIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids = raw
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter((item): item is string => UUID_RE.test(item))
  return [...new Set(ids)]
}

export function parseCampaignAudienceRules(input: unknown): CrmCampaignAudienceRules {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    lifecycleStatuses: clampCampaignLifecycleStatuses(raw.lifecycleStatuses),
    onlyWithEmail: raw.onlyWithEmail !== false,
    includeOptedOut: raw.includeOptedOut === true,
    search: typeof raw.search === 'string' ? raw.search.trim().slice(0, 120) : '',
    stageIds: normalizeStageIdList(raw.stageIds),
  }
}

function mapRecipientCounts(
  recipientRows: Array<{ campaign_id: string; provider_status: string | null }>,
): Map<string, CrmCampaignRecipientCounts> {
  const counts = new Map<string, CrmCampaignRecipientCounts>()
  for (const row of recipientRows) {
    const next = counts.get(row.campaign_id) ?? emptyCampaignRecipientCounts()
    next.total += 1
    const key = row.provider_status ? CAMPAIGN_RECIPIENT_STATUS_MAP[row.provider_status] : undefined
    if (key) next[key] += 1
    counts.set(row.campaign_id, next)
  }
  return counts
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

export function getLifecycleLabel(lifecycle: CrmPeopleFilter['lifecycle']): string {
  return LIFECYCLE_LABEL[lifecycle]
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

export async function fetchCrmPeople(limit = 200): Promise<{ people: CrmPeopleRow[]; error: string | null }> {
  const admin = getAdminClient()
  const { data: rawPeople, error: peopleError } = await admin
    .from('cornerstone_crm_people')
    .select('*')
    .order('updated_at', { ascending: false })
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
        campaignOptOut: person.campaign_opt_out,
        syncState: person.sync_state,
        stageId: person.stage_id,
        stageName: stage?.name ?? null,
        stageSlug: stage?.slug ?? null,
        stageEnteredAt: person.stage_entered_at ?? null,
        twentyContactId: person.twenty_contact_id,
        sourceRecordId: person.lead_id ?? person.cornerstone_matter_id,
        sourceRecordHref: sourceHref,
        sourceRecordLabel: sourceLabel,
        lastSyncedAt: person.last_synced_at,
        createdAt: person.created_at,
        updatedAt: person.updated_at,
      }
    }),
    error: null,
  }
}

export async function fetchCrmCampaigns(params?: {
  search?: string
  type?: CrmCampaignType
  status?: CrmCampaignStatus
  limit?: number
}): Promise<{ campaigns: CrmCampaignListItem[]; error: string | null }> {
  const admin = getAdminClient()
  const campaignRowsLimit = Math.max(1, Math.min(params?.limit ?? 250, 500))

  let campaignQuery = admin
    .from('cornerstone_crm_campaigns')
    .select('id, name, type, status, audience_rules, email_provider, provider_template_id, send_schedule_cron_or_date, subject, body_text, body_html, created_by_user_id, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(campaignRowsLimit)

  const requestedType = params?.type
  const requestedStatus = params?.status
  if (requestedType) campaignQuery = campaignQuery.eq('type', requestedType)
  if (requestedStatus) campaignQuery = campaignQuery.eq('status', requestedStatus)

  const search = params?.search?.trim() ?? ''
  if (search) campaignQuery = campaignQuery.ilike('name', `%${search}%`)

  const { data: campaignsData, error: campaignError } = await campaignQuery
  if (campaignError) return { campaigns: [], error: campaignError.message }

  const campaigns = (campaignsData as CrmCampaignDbRow[]) ?? []
  if (!campaigns.length) return { campaigns: [], error: null }

  const campaignIds = campaigns.map(row => row.id)
  const { data: recipientRows, error: recipientError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('campaign_id, provider_status')
    .in('campaign_id', campaignIds)

  if (recipientError) return { campaigns: [], error: recipientError.message }
  const statsByCampaign = mapRecipientCounts(recipientRows as Array<{ campaign_id: string; provider_status: string | null }> ?? [])
  for (const row of campaigns) {
    if (!statsByCampaign.has(row.id)) statsByCampaign.set(row.id, emptyCampaignRecipientCounts())
  }

  return {
    campaigns: campaigns.map(row => {
      const audienceRules = parseCampaignAudienceRules(row.audience_rules)
      const recipientCounts = statsByCampaign.get(row.id) ?? emptyCampaignRecipientCounts()
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status,
        audienceRules,
        emailProvider: row.email_provider,
        subject: row.subject,
        bodyText: row.body_text,
        bodyHtml: row.body_html,
        providerTemplateId: row.provider_template_id,
        sendScheduleCronOrDate: row.send_schedule_cron_or_date,
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        recipientCounts,
      }
    }),
    error: null,
  }
}

export async function fetchCrmCampaignById(campaignId: string): Promise<{
  campaign: CrmCampaignListItem | null
  error: string | null
}> {
  const admin = getAdminClient()
  const { data: campaignData, error: campaignError } = await admin
    .from('cornerstone_crm_campaigns')
    .select('id, name, type, status, audience_rules, email_provider, provider_template_id, send_schedule_cron_or_date, subject, body_text, body_html, created_by_user_id, created_at, updated_at')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignError) return { campaign: null, error: campaignError.message }
  if (!campaignData) return { campaign: null, error: null }
  const row = campaignData as CrmCampaignDbRow

  const { data: recipientRows, error: recipientError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('campaign_id, provider_status')
    .eq('campaign_id', campaignId)

  if (recipientError) return { campaign: null, error: recipientError.message }

  const recipientCounts = mapRecipientCounts(recipientRows as Array<{ campaign_id: string; provider_status: string | null }> ?? [])
    .get(campaignId)
    ?? emptyCampaignRecipientCounts()

  return {
    campaign: {
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      audienceRules: parseCampaignAudienceRules(row.audience_rules),
      emailProvider: row.email_provider,
      subject: row.subject,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      providerTemplateId: row.provider_template_id,
      sendScheduleCronOrDate: row.send_schedule_cron_or_date,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      recipientCounts,
    },
    error: null,
  }
}

export function filterCrmPeople(people: CrmPeopleRow[], filter: CrmPeopleFilter): CrmPeopleRow[] {
  const search = filter.search.trim().toLowerCase()

  return people.filter(person => {
    if (filter.lifecycle !== 'all' && person.lifecycleStatus !== filter.lifecycle) return false
    if (!search) return true

    const haystack = [
      person.name,
      person.email,
      person.company,
      person.city,
      person.state,
      person.country,
      person.leadSource,
      person.referralSource,
      person.stageName,
      person.stageSlug,
      person.jobTitle,
      person.sourceRecordLabel,
    ]
      .filter((value): value is string => Boolean(value))
      .map(value => value.toLowerCase())
    return haystack.some(value => value.includes(search))
  })
}
