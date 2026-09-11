import Link from 'next/link'
import { fetchBillingData } from '@/lib/queries/billing'
import { FinanceHeroCards } from './FinanceHeroCards'
/** Secondary financial summaries stream independently of the working ledger. */
export async function BillingSummary({userId,month}:{userId:string;month:string}) {
  const result=await fetchBillingData({userId,selectedMonth:month})
  if(result.error) return <p role="alert">Financial summary unavailable. <Link href="/admin/billing?tab=insights" className="underline">Retry in insights</Link></p>
  return <FinanceHeroCards snapshot={result.snapshot} />
}
