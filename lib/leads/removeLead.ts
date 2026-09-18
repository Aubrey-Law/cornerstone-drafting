import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveEsignProvider } from '@/lib/esign/firma'
import {
  MatterDeletionError,
  deleteMatter,
  type DeleteMatterOptions,
  type MatterDeletionProtection,
} from '@/lib/matters/deleteMatter'

type LeadRecord = {
  id: string
  matter_id: string | null
  engagement_envelope_id: string | null
  engagement_status: string | null
}

const LEAD_COLUMNS = 'id, matter_id, engagement_envelope_id, engagement_status'

async function loadLead(admin: SupabaseClient, intakeId: string): Promise<LeadRecord> {
  const { data, error } = await admin
    .from('client_intake')
    .select(LEAD_COLUMNS)
    .eq('id', intakeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Lead not found')
  return data as LeadRecord
}

/**
 * Withdraw a signature request that is about to lose the record behind it.
 * A signed envelope is left alone — it is the executed agreement.
 */
async function cancelPendingEngagement(lead: LeadRecord): Promise<void> {
  if (!lead.engagement_envelope_id || lead.engagement_status === 'signed') return
  const resolved = resolveEsignProvider()
  if (!resolved.ok) return
  await resolved.provider.cancelEnvelope(lead.engagement_envelope_id) // swallows its own errors
}

/**
 * Archive a prospective matter. Lost/prospect history and intake documents are
 * retained; hired matters must use the matter close/archive workflow.
 *
 * The reversible exit. `deleteLeadPermanently` is the other one.
 */
export async function archiveLead(admin: SupabaseClient, intakeId: string) {
  const lead = await loadLead(admin, intakeId)
  if (!lead.matter_id) throw new Error('Lead opportunity is not initialized')

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', lead.matter_id)
    .maybeSingle()
  if (matterError) throw new Error(matterError.message)
  if (!matter) throw new Error('Lead opportunity is not initialized')
  if (matter.relationship_status === 'hired') throw new Error('Hired matters cannot be removed from Leads')

  await cancelPendingEngagement(lead)

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

export type DeleteLeadResult = {
  intakeId: string
  /** Null for an intake that never got as far as an opportunity. */
  matterId: string | null
  protections: MatterDeletionProtection[]
  documentsDeleted: number
}

/**
 * Destroy a lead outright — the intake row, the opportunity behind it, and
 * everything hanging off both.
 *
 * Archiving keeps the lead and its history; this is for the rows that should
 * never have existed: a duplicate, a test record, spam through the web form.
 * The opportunity is what owns the documents and the activity, so the work is
 * `deleteMatter`'s — including its protections, which is why a hired matter or
 * a signed engagement still comes back as `confirmation_required` here rather
 * than quietly going through.
 */
export async function deleteLeadPermanently(
  admin: SupabaseClient,
  intakeId: string,
  options: DeleteMatterOptions = {},
): Promise<DeleteLeadResult> {
  let lead: LeadRecord
  try {
    lead = await loadLead(admin, intakeId)
  } catch (error) {
    if (error instanceof Error && error.message === 'Lead not found') {
      throw new MatterDeletionError('Lead not found', 'not_found')
    }
    throw error
  }

  await cancelPendingEngagement(lead)

  if (lead.matter_id) {
    const result = await deleteMatter(admin, lead.matter_id, options)
    return {
      intakeId,
      matterId: result.matterId,
      protections: result.protections,
      documentsDeleted: result.documentsDeleted,
    }
  }

  // No opportunity of its own — but `matters.client_intake_id` is ON DELETE
  // RESTRICT, so a matter that points here without the back-reference being set
  // would fail the delete halfway. Named rather than left to the constraint.
  const { data: owningMatter, error: owningError } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', intakeId)
    .limit(1)
    .maybeSingle()
  if (owningError) throw new Error(owningError.message)
  if (owningMatter) {
    const result = await deleteMatter(admin, owningMatter.id as string, options)
    return {
      intakeId,
      matterId: result.matterId,
      protections: result.protections,
      documentsDeleted: result.documentsDeleted,
    }
  }

  const { error: deleteError } = await admin.from('client_intake').delete().eq('id', intakeId)
  if (deleteError) throw new Error(deleteError.message)

  return { intakeId, matterId: null, protections: [], documentsDeleted: 0 }
}
