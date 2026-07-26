import type { SupabaseClient } from '@supabase/supabase-js'

const PROGRESSED = new Set(['sent', 'signed'])

/**
 * Record that an engagement draft exists so the matter page status dropdown
 * reads Draft. Never downgrades a matter/lead whose engagement has already
 * been sent or signed.
 */
export async function markEngagementDraftStatus(
  admin: SupabaseClient,
  input: { matterId: string; leadId?: string | null },
) {
  const { data: details } = await admin
    .from('matter_details')
    .select('engagement_status, engagement_signed, engagement_sent_at')
    .eq('client_id', input.matterId)
    .maybeSingle()
  if (
    !details?.engagement_signed
    && !details?.engagement_sent_at
    && !PROGRESSED.has(details?.engagement_status ?? '')
  ) {
    const { error } = await admin
      .from('matter_details')
      .upsert({ client_id: input.matterId, engagement_status: 'draft' }, { onConflict: 'client_id' })
    if (error) throw new Error(error.message)
  }

  if (input.leadId) {
    const { data: lead } = await admin
      .from('client_intake')
      .select('engagement_status, engagement_sent_at')
      .eq('id', input.leadId)
      .maybeSingle()
    if (lead && !lead.engagement_sent_at && !PROGRESSED.has(lead.engagement_status ?? '')) {
      const { error } = await admin
        .from('client_intake')
        .update({ engagement_status: 'draft' })
        .eq('id', input.leadId)
      if (error) throw new Error(error.message)
    }
  }
}

/**
 * Mirror a workspace-agreement send onto matter_details (and the source lead)
 * so the matter page and leads pipeline read Sent. The legacy send routes
 * write these columns directly; this covers the reviewed-workspace flow.
 */
export async function markEngagementSentStatus(admin: SupabaseClient, matterId: string) {
  const now = new Date().toISOString()
  const { data: details } = await admin
    .from('matter_details')
    .select('engagement_status, engagement_signed')
    .eq('client_id', matterId)
    .maybeSingle()
  if (!details?.engagement_signed && details?.engagement_status !== 'signed') {
    const { error } = await admin
      .from('matter_details')
      .upsert(
        { client_id: matterId, engagement_status: 'sent', engagement_sent_at: now },
        { onConflict: 'client_id' },
      )
    if (error) throw new Error(error.message)
  }

  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()
  if (matter?.client_intake_id) {
    const { data: lead } = await admin
      .from('client_intake')
      .select('id, engagement_status')
      .eq('id', matter.client_intake_id)
      .maybeSingle()
    if (lead && lead.engagement_status !== 'signed') {
      const { error } = await admin
        .from('client_intake')
        .update({ engagement_status: 'sent', engagement_sent_at: now })
        .eq('id', lead.id)
      if (error) throw new Error(error.message)
    }
  }
}
