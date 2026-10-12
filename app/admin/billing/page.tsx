import type { Metadata } from 'next'
import { getCachedClaims } from '@/lib/supabaseServer'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchBillingData, fetchBillingMatterOptions, fetchLedgerPage } from '@/lib/queries/billing'
import { InvoiceRegister } from './InvoiceRegister'
import { Suspense } from 'react'
import { MercuryDeposits } from './MercuryDeposits'
import { buildBillingSnapshot } from '@/lib/billing/metrics'
import type { BillingFilter } from '@/lib/billing/types'
import { monthRange, pageRequest } from '@/lib/queries/page'
import BillingClient from './BillingClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Billing' }

function selectedMonth(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate) { monthRange(candidate); return candidate }
  return firmTodayKey().slice(0, 7)
}
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string,string|string[]|undefined>>
}) {
  const auth = await getCachedClaims()
  if (!auth) return null
  const params = await searchParams
  if (params.tab === 'invoices') return <InvoiceRegister params={params} />
  if (params.tab === 'ledger') {
    const month=selectedMonth(params.month)
    const filter=typeof params.filter==='string' ? params.filter as BillingFilter : 'open'
    const ledger=await fetchLedgerPage({...pageRequest({page:params.page}),filter,search:typeof params.search==='string' ? params.search : '',month})
    const snapshot=buildBillingSnapshot({items:[],payments:[],selectedMonth:month,annualGoalCents:0,dismissedNudgeKeys:[],unpreparedClaims:[]})
    snapshot.rows=ledger.rows
    return <BillingClient initialSnapshot={snapshot} loadError={null} weekStart="" matterOptions={[]} invoices={[]} pagination={ledger} />
  }
  const [data, matterOptions] = await Promise.all([
    fetchBillingData({
      userId: auth.id,
      selectedMonth: selectedMonth(params.month),
    }),
    fetchBillingMatterOptions(),
  ])
  if(data.error) throw new Error('Billing insights are temporarily unavailable. Please retry.')
  return (
    <BillingClient
      initialSnapshot={data.snapshot}
      loadError={data.error}
      weekStart={data.weekStart}
      matterOptions={matterOptions}
      invoices={[]}
      bankDeposits={params.tab === 'insights' ? (
        <Suspense fallback={<p className="text-xs text-muted-foreground">Loading bank deposits…</p>}>
          <MercuryDeposits />
        </Suspense>
      ) : undefined}
    />
  )
}
