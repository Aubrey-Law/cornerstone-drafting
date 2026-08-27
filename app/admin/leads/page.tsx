import { Suspense } from 'react'
import { isEsignConfigured } from '@/lib/esign/firma'
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

  return (
    <div className="space-y-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LeadsClient
          initialLeads={rows as LeadRow[]}
          params={params}
          total={total}
          hasMore={hasMore}
          summary={summary}
          esignEnabled={isEsignConfigured()}
        />
      </Suspense>
    </div>
  )
}
