import { redirect } from 'next/navigation'
import { PortalAccountCard } from '@/components/portal/PortalAccountCard'
import { createServerSupabase, getCachedClaims } from '@/lib/supabaseServer'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { fetchPortalAccount } from '@/lib/queries/portal'

export const dynamic = 'force-dynamic'

export default async function PortalAccountPage() {
  const auth = await getCachedClaims()
  if (!auth) redirect('/auth/login')
  const supabase = await createServerSupabase()
  const matter = await getMatterForUser(supabase, auth.id)
  const account = matter
    ? await fetchPortalAccount(matter.id)
    : { invoices: [], balanceCents: 0, nextDueDate: null }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Review balances, pay open invoices, and download paid invoices as receipts.
      </p>
      <div className="mt-6">
        <PortalAccountCard account={account} showAll />
      </div>
    </div>
  )
}
