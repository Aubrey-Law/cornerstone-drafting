import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteR2Key } from '@/lib/r2Delete'
import { resolveEsignProvider } from '@/lib/esign/firma'

/**
 * Permanently delete a lead (a client_intake row with no matter). Refuses
 * converted leads (delete the matter instead), best-effort cancels a live
 * engagement envelope, and cleans up intake-document R2 blobs (their DB rows
 * cascade). contacts / contact_roles / asset_intake cascade; design_sheets /
 * intake_invite_audit are set null.
 */
export async function deleteLead(admin: SupabaseClient, intakeId: string) {
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, matter_id, engagement_envelope_id, engagement_status')
    .eq('id', intakeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!lead) throw new Error('Lead not found')
  if (lead.matter_id) throw new Error('Lead already converted to a matter')

  const envelopeId = lead.engagement_envelope_id as string | null
  if (envelopeId && lead.engagement_status !== 'signed') {
    const resolved = resolveEsignProvider()
    if (resolved.ok) {
      await resolved.provider.cancelEnvelope(envelopeId) // swallows its own errors
    }
  }

  const { data: docs } = await admin
    .from('intake_documents')
    .select('r2_key')
    .eq('client_intake_id', intakeId)
  for (const doc of docs ?? []) {
    await deleteR2Key(doc.r2_key as string | null)
  }

  const { error: deleteError } = await admin.from('client_intake').delete().eq('id', intakeId)
  if (deleteError) throw new Error(deleteError.message)
}
