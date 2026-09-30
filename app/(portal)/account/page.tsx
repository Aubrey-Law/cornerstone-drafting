import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PortalAccountCard } from '@/components/portal/PortalAccountCard'
import { PortalPageHeader } from '../PortalPageHeader'
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
    ? await fetchPortalAccount(matter.id).catch(() => null)
    : { invoices: [], balanceCents: 0, nextDueDate: null }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PortalPageHeader
        title="Billing"
        description="Review balances, pay open invoices, and download paid invoices as receipts."
      />
      {account ? (
        <PortalAccountCard account={account} showAll />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Billing is temporarily unavailable. <Link href="/account" className="underline">Retry billing</Link>
        </p>
      )}
    </div>
  )
}
