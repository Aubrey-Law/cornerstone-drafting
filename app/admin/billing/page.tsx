import type { Metadata } from 'next'
import { getCachedClaims } from '@/lib/supabaseServer'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchBillingData, fetchBillingMatterOptions } from '@/lib/queries/billing'
import BillingClient from './BillingClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Billing' }

function selectedMonth(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && /^\d{4}-\d{2}$/.test(candidate)
    ? candidate
    : firmTodayKey().slice(0, 7)
}
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>
}) {
  const auth = await getCachedClaims()
  if (!auth) return null
  const params = await searchParams
  const [data, matterOptions] = await Promise.all([
    fetchBillingData({
      userId: auth.id,
      selectedMonth: selectedMonth(params.month),
    }),
    fetchBillingMatterOptions(),
  ])
  return (
    <BillingClient
      initialSnapshot={data.snapshot}
      loadError={data.error}
      weekStart={data.weekStart}
      matterOptions={matterOptions}
    />
  )
}
