import { Suspense } from 'react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isEsignConfigured } from '@/lib/esign/firma'
import type { LeadSpouseRecord } from '@/lib/leads/viewTypes'
import { loadMatterContactsForMatters } from '@/lib/contacts/loadMatterContacts'
import { fetchLeadListPage } from '@/lib/queries/leadList'
import {
  clampShow,
  LEAD_PAGE_SIZE,
  type LeadCardFilterKey,
  type LeadListParams,
  type LeadStatusFilter,
} from '@/lib/leads/listParams'
import type { LeadProgressFilter, LeadSortKey } from '@/lib/adminTables/leadTable'
import { LeadsClient, type LeadRow } from './LeadsClient'

export const dynamic = 'force-dynamic'

const STATUS_FILTERS: LeadStatusFilter[] = ['open', 'lost', 'declined', 'all']
const CARD_FILTERS: LeadCardFilterKey[] = ['attention', 'agreements']
const PROGRESS_FILTERS: LeadProgressFilter[] = [
  'all', 'intake_not_sent', 'intake_pending', 'intake_complete', 'engagement_pending', 'engagement_signed',
]
const SORT_KEYS: LeadSortKey[] = [
  'newest', 'oldest', 'name_asc', 'name_desc', 'fee_desc', 'last_activity', 'score_desc',
]

type SearchParams = Record<string, string | string[] | undefined>

function one(params: SearchParams, key: string): string {
  const value = params[key]
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/**
 * The list's filters, sort and page size live in the URL because the query now
 * runs on the server: the URL is what a refresh, a shared link and the "load
 * more" button all replay. An unknown value falls back rather than erroring —
 * a hand-edited URL should show the default list, not a stack trace.
 */
function readParams(params: SearchParams): LeadListParams {
  const status = one(params, 'status') as LeadStatusFilter
  const card = one(params, 'card') as LeadCardFilterKey
  const progress = one(params, 'progress') as LeadProgressFilter
  const sort = one(params, 'sort') as LeadSortKey
  return {
    status: STATUS_FILTERS.includes(status) ? status : 'open',
    card: CARD_FILTERS.includes(card) ? card : null,
    search: one(params, 'q'),
    practice: one(params, 'practice') || 'all',
    progress: PROGRESS_FILTERS.includes(progress) ? progress : 'all',
    sort: SORT_KEYS.includes(sort) ? sort : 'newest',
    show: clampShow(Number(one(params, 'show')) || LEAD_PAGE_SIZE),
  }
}

export default async function LeadsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = readParams((await searchParams) ?? {})
  const { rows, total, hasMore, summary, error } = await fetchLeadListPage(params)

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-destructive">
          Could not load leads ({error}). Apply the lead engagement migration if needed.
        </p>
      </div>
    )
  }

  // Spouses come from the join (step 3 of docs/matter-contacts-migration.md),
  // batched across the page's matters so the flip does not turn one query into
  // one per lead. Lead URLs stay intake-based, so the result is keyed back to
  // the lead id the list renders with.
  const spousesByLead = new Map<string, LeadSpouseRecord>()
  const leadIdByMatterId = new Map<string, string>()
  for (const lead of rows) {
    if (lead.matter_id) leadIdByMatterId.set(lead.matter_id, lead.id)
  }
  if (leadIdByMatterId.size > 0) {
    try {
      const byMatter = await loadMatterContactsForMatters(
        getAdminClient(),
        [...leadIdByMatterId.keys()],
        'id, first_name, middle_name, last_name, preferred_name, email, phone, date_of_birth',
      )
      for (const [matterId, contacts] of byMatter) {
        const leadId = leadIdByMatterId.get(matterId)
        if (!leadId || spousesByLead.has(leadId)) continue
        const spouse = contacts.find(row => row.relationship_type === 'spouse')
        if (spouse) spousesByLead.set(leadId, spouse as unknown as LeadSpouseRecord)
      }
    } catch (spouseError) {
      console.error('Could not load lead spouses', { error: spouseError })
    }
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LeadsClient
          initialLeads={rows as LeadRow[]}
          params={params}
          total={total}
          hasMore={hasMore}
          summary={summary}
          spouses={Object.fromEntries(spousesByLead)}
          esignEnabled={isEsignConfigured()}
        />
      </Suspense>
    </div>
  )
}
