import { getAdminClient } from '@/lib/supabaseAdmin'
import type { LeadLookupRow } from '@/lib/calcom/types'

type AdminClient = ReturnType<typeof getAdminClient>

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
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(1)

  if (matterErr) throw matterErr
  return matterRows?.[0]?.id ?? null
}

export async function matterExists(admin: AdminClient, matterId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('matters')
    .select('id')
    .eq('id', matterId)
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
