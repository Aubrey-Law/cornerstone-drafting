import { Suspense } from 'react'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isEsignConfigured } from '@/lib/esign/firma'
import type { LeadSpouseRecord } from '@/lib/leads/viewTypes'
import { loadMatterContactsForMatters } from '@/lib/contacts/loadMatterContacts'
import { scoringAppointmentAt } from '@/lib/leads/score'
import { LeadsClient, type LeadRow } from './LeadsClient'

export const dynamic = 'force-dynamic'

/**
 * Lifecycle states that still belong on the leads list. A `hired` opportunity
 * leaves for its matter; everything else stays visible, including one declined
 * at discovery — a declined lead that cannot be seen also cannot be reviewed or
 * reopened, and `lost` and `declined` are deliberately distinct.
 */
const LEAD_LIST_STATUSES = new Set(['lead', 'lost', 'declined'])

export default async function LeadsPage() {
  const admin = getAdminClient()

  // Lead URLs remain intake-based, while the linked matter owns lifecycle.
  const { data, error } = await admin
    .from('client_intake')
    .select(
      // The record side panel edits the same fields as the lead detail rail, so
      // the list loads the full detail shape rather than adding a lead API.
      // `billing_type` is loaded for lead scoring: a legal plan member with no
      // fee quoted still carries a covered engagement.
      'id, full_name, first_name, middle_name, last_name, preferred_name, email, phone, date_of_birth, address_line1, address_line2, city, state, zip, county, marital_status, qualification_notes, has_minor_children, lead_source, practice_area, status, lead_status, matter_id, intake_sent_at, intake_completed_at, engagement_status, engagement_sent_at, engagement_signed_at, engagement_fee_quoted, billing_type, lead_urgency, taxable_estate, lead_next_action_snoozed_until, user_id, client_user_id, created_at, updated_at',
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
  // The meeting anchors ride along for lead scoring: a lead with a call on the
  // calendar outranks one without, and both anchors live on the matter.
  const { data: opportunities } = matterIds.length
    ? await admin
      .from('matters')
      .select('id, relationship_status, status, discovery_call_at, pmps_at')
      .in('id', matterIds)
    : {
      data: [] as Array<{
        id: string
        relationship_status: string
        status: string
        discovery_call_at: string | null
        pmps_at: string | null
      }>,
    }
  const opportunityById = new Map((opportunities ?? []).map(row => [row.id, row]))
  const leads = candidateLeads
    .map(lead => ({ ...lead, lead_status: opportunityById.get(lead.matter_id ?? '')?.relationship_status ?? lead.lead_status }))
    .filter(lead => opportunityById.get(lead.matter_id ?? '')?.status !== 'archived')
    .filter(lead => LEAD_LIST_STATUSES.has(lead.lead_status ?? 'lead'))
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

  // Spouses come from the join (step 3 of docs/matter-contacts-migration.md),
  // batched across every lead's matter so the flip does not turn one query into
  // one per lead. Lead URLs stay intake-based, so the result is keyed back to
  // the lead id the list renders with.
  const spousesByLead = new Map<string, LeadSpouseRecord>()
  const leadIdByMatterId = new Map<string, string>()
  for (const lead of leads) {
    if (lead.matter_id) leadIdByMatterId.set(lead.matter_id, lead.id)
  }
  if (leadIdByMatterId.size > 0) {
    try {
      const byMatter = await loadMatterContactsForMatters(
        admin,
        [...leadIdByMatterId.keys()],
        'id, first_name, middle_name, last_name, preferred_name, email, phone, date_of_birth',
      )
      for (const [matterId, rows] of byMatter) {
        const leadId = leadIdByMatterId.get(matterId)
        if (!leadId || spousesByLead.has(leadId)) continue
        const spouse = rows.find(row => row.relationship_type === 'spouse')
        if (spouse) spousesByLead.set(leadId, spouse as unknown as LeadSpouseRecord)
      }
    } catch (spouseError) {
      console.error('Could not load lead spouses', { error: spouseError })
    }
  }

  const leadsWithActivity = leads.map(lead => {
    const opportunity = opportunityById.get(lead.matter_id ?? '')
    return {
      ...lead,
      last_activity_at: latestActivity.get(lead.id) ?? null,
      next_appointment_at: scoringAppointmentAt(opportunity?.discovery_call_at, opportunity?.pmps_at),
    }
  })

  return (
    <div className="space-y-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LeadsClient
          initialLeads={leadsWithActivity as LeadRow[]}
          spouses={Object.fromEntries(spousesByLead)}
          esignEnabled={isEsignConfigured()}
        />
      </Suspense>
    </div>
  )
}
