import { getAdminClient } from '@/lib/supabaseAdmin'

type AdminClient = ReturnType<typeof getAdminClient>

export interface LeadLookupRow {
  id: string
  lead_status: string | null
}

export async function findMatterIdByEmail(
  admin: AdminClient,
  attendeeEmail: string,
): Promise<string | null> {
  const { data: intakeRows, error: intakeErr } = await admin
    .from('client_intake')
    .select('id')
    .ilike('email', attendeeEmail)
    .limit(5)

  if (intakeErr) throw intakeErr
  if (!intakeRows?.length) return null

  const intakeIds = intakeRows.map((row: { id: string }) => row.id)

  const { data: matterRows, error: matterErr } = await admin
    .from('matters')
    .select('id')
    .in('client_intake_id', intakeIds)
    .eq('relationship_status', 'hired')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(1)

  if (matterErr) throw matterErr
  return matterRows?.[0]?.id ?? null
}

/**
 * The `matters` row behind a lead. A lead owns one from the moment it is created
 * (`ensure_lead_matter`), which is where its SLA plan and date anchors live, so
 * pre-engagement work has somewhere to land long before anyone is hired.
 *
 * `findMatterIdByEmail` deliberately cannot answer this: it is hired-only,
 * because the surfaces it feeds are about live client work.
 *
 * Ordering mirrors `ensure_lead_matter`: the lead's own `matter_id` wins, then
 * the most recent, so both agree on which row is the opportunity.
 */
export async function findMatterIdByLeadId(
  admin: AdminClient,
  leadId: string,
): Promise<string | null> {
  const { data: lead, error: leadErr } = await admin
    .from('client_intake')
    .select('matter_id')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr) throw leadErr

  const { data, error } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', leadId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw error

  const rows = (data ?? []) as { id: string }[]
  if (!rows.length) return null

  const preferred = (lead as { matter_id: string | null } | null)?.matter_id ?? null
  return rows.find(row => row.id === preferred)?.id ?? rows[0].id
}

export async function matterExists(admin: AdminClient, matterId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function findLeadById(
  admin: AdminClient,
  leadId: string,
): Promise<LeadLookupRow | null> {
  const { data, error } = await admin
    .from('client_intake')
    .select('id, lead_status')
    .eq('id', leadId)
    .not('lead_status', 'is', null)
    .maybeSingle()
  if (error) throw error
  return data as LeadLookupRow | null
}

export async function findLeadByEmail(
  admin: AdminClient,
  attendeeEmail: string,
): Promise<LeadLookupRow | null> {
  const { data, error } = await admin
    .from('client_intake')
    .select('id, lead_status')
    .ilike('email', attendeeEmail)
    .not('lead_status', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as LeadLookupRow | null
}
