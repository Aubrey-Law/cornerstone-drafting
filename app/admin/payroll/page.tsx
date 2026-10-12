import type { Metadata } from 'next'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { firmTodayKey } from '@/lib/firmDate'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import PayrollClient from './PayrollClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Payroll' }

export default async function PayrollPage() {
  const auth = await getCachedClaims()
  if (!auth) return null
  const role = await getCachedUserRole(auth.id)
  if (role !== 'admin') {
    return (
      <AdminPageShell className="mx-auto w-full max-w-3xl">
        <h1 className="text-xl font-semibold">Payroll</h1>
        <p className="text-sm text-muted-foreground">Payroll is limited to administrators.</p>
        <p className="text-sm text-muted-foreground">Ask a firm operator to grant administrator access. Signed-in staff cannot change their own role.</p>
      </AdminPageShell>
    )
  }
  const today = firmTodayKey()
  return <PayrollClient initialYear={Number(today.slice(0, 4))} today={today} />
}
