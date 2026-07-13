import { Suspense } from 'react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isEsignConfigured } from '@/lib/esign/firma'
import { LeadsClient, type LeadRow } from './LeadsClient'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const admin = getAdminClient()

  // A lead is any client_intake row that went through the lead flow
  // (lead_status set). Open leads have no matter; hired leads carry matter_id.
  const { data, error } = await admin
    .from('client_intake')
    .select(
      'id, full_name, first_name, last_name, email, phone, practice_area, status, lead_status, matter_id, intake_sent_at, intake_completed_at, engagement_status, engagement_sent_at, engagement_signed_at, engagement_fee_quoted, lead_urgency, taxable_estate, created_at, updated_at',
    )
    .not('lead_status', 'is', null)
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

  const leads = data ?? []
  const leadIds = leads.map(lead => lead.id)
  const latestActivity = new Map<string, string>()
  if (leadIds.length > 0) {
    const { data: activity } = await admin
      .from('lead_activity')
      .select('lead_id, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false })
      .limit(2000)
    for (const row of activity ?? []) {
      if (!latestActivity.has(row.lead_id)) latestActivity.set(row.lead_id, row.created_at)
    }
  }

  const leadsWithActivity = leads.map(lead => ({
    ...lead,
    last_activity_at: latestActivity.get(lead.id) ?? null,
  }))

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
        <LeadsClient initialLeads={leadsWithActivity as LeadRow[]} esignEnabled={isEsignConfigured()} />
      </Suspense>
    </div>
  )
}
