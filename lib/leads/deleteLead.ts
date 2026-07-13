import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveEsignProvider } from '@/lib/esign/firma'

/**
 * Archive a prospective matter. Lost/prospect history and intake documents are
 * retained; hired matters must use the matter close/archive workflow.
 */
export async function deleteLead(admin: SupabaseClient, intakeId: string) {
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, matter_id, engagement_envelope_id, engagement_status')
    .eq('id', intakeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!lead) throw new Error('Lead not found')
  if (!lead.matter_id) throw new Error('Lead opportunity is not initialized')

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', lead.matter_id)
    .maybeSingle()
  if (matterError) throw new Error(matterError.message)
  if (!matter) throw new Error('Lead opportunity is not initialized')
  if (matter.relationship_status === 'hired') throw new Error('Hired matters cannot be removed from Leads')

  const envelopeId = lead.engagement_envelope_id as string | null
  if (envelopeId && lead.engagement_status !== 'signed') {
    const resolved = resolveEsignProvider()
    if (resolved.ok) {
      await resolved.provider.cancelEnvelope(envelopeId) // swallows its own errors
    }
  }

  const { error: archiveError } = await admin
    .from('matters')
    .update({ status: 'archived', relationship_status: 'lost', lost_at: new Date().toISOString() })
    .eq('id', matter.id)
  if (archiveError) throw new Error(archiveError.message)

  const { error: mirrorError } = await admin
    .from('client_intake')
    .update({ lead_status: 'lost', updated_at: new Date().toISOString() })
    .eq('id', intakeId)
  if (mirrorError) throw new Error(mirrorError.message)
}
