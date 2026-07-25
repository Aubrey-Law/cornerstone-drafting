import { Suspense } from 'react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isEsignConfigured } from '@/lib/esign/firma'
import { LeadsClient, type LeadRow } from './LeadsClient'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const admin = getAdminClient()

  // Lead URLs remain intake-based, while the linked matter owns lifecycle.
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

  const candidateLeads = data ?? []
  const matterIds = candidateLeads.map(lead => lead.matter_id).filter((id): id is string => Boolean(id))
  const { data: opportunities } = matterIds.length
    ? await admin.from('matters').select('id, relationship_status, status').in('id', matterIds)
    : { data: [] as Array<{ id: string; relationship_status: string; status: string }> }
  const opportunityById = new Map((opportunities ?? []).map(row => [row.id, row]))
  const leads = candidateLeads
    .map(lead => ({ ...lead, lead_status: opportunityById.get(lead.matter_id ?? '')?.relationship_status ?? lead.lead_status }))
    .filter(lead => opportunityById.get(lead.matter_id ?? '')?.status !== 'archived')
    .filter(lead => lead.lead_status === 'lead' || lead.lead_status === 'lost')
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
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LeadsClient initialLeads={leadsWithActivity as LeadRow[]} esignEnabled={isEsignConfigured()} />
      </Suspense>
    </div>
  )
}
