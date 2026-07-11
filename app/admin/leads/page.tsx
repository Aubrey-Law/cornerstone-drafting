import { Suspense } from 'react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isEsignConfigured } from '@/lib/esign/firma'
import { LeadsClient, type LeadRow } from './LeadsClient'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const admin = getAdminClient()

  // A lead is a standalone client_intake row — no matter references it yet.
  const { data, error } = await admin
    .from('client_intake')
    .select(
      'id, full_name, first_name, last_name, email, phone, practice_area, status, intake_sent_at, intake_completed_at, engagement_status, engagement_sent_at, engagement_signed_at, engagement_fee_quoted, created_at',
    )
    .is('matter_id', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-destructive">
          Could not load leads ({error.message}). Apply the lead engagement migration if needed.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          New clients before the engagement is signed — send the intake and engagement agreement
          from here. Signing the engagement creates the matter automatically.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LeadsClient initialLeads={(data ?? []) as LeadRow[]} esignEnabled={isEsignConfigured()} />
      </Suspense>
    </div>
  )
}
