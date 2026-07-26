import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteR2Key } from '@/lib/r2Delete'

/** Permanently delete a matter, its intake, documents (DB + best-effort R2), and related rows. */
export async function deleteMatter(admin: SupabaseClient, matterId: string) {
  const { data: matter, error: fetchError } = await admin
    .from('matters')
    .select('id, client_intake_id, relationship_status')
    .eq('id', matterId)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!matter) throw new Error('Matter not found')
  if (matter.relationship_status === 'hired') {
    throw new Error('Hired matters must be closed or archived, not permanently deleted')
  }

  const { data: signedAgreement, error: agreementError } = await admin
    .from('engagement_agreements')
    .select('id')
    .eq('matter_id', matterId)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle()
  if (agreementError) throw new Error(agreementError.message)
  if (signedAgreement) throw new Error('Matters with signed engagements cannot be permanently deleted')

  const intakeId = matter.client_intake_id as string

  // Collect the storage keys now, but do NOT delete blobs yet. Destroying files
  // first meant any later failure (e.g. estate_clauses.representative_matter_id
  // is ON DELETE RESTRICT) left live matter_documents/document_versions rows
  // pointing at objects that no longer exist — visible in the UI, unrecoverable.
  // Same ordering the single-document route uses: DB first, storage last.
  const { data: docs, error: docsError } = await admin
    .from('matter_documents')
    .select('id, r2_key')
    .eq('matter_id', matterId)
  if (docsError) throw new Error(docsError.message)

  const r2Keys: (string | null)[] = []
  if (docs?.length) {
    r2Keys.push(...docs.map(d => d.r2_key as string | null))

    const { data: versions, error: versionsError } = await admin
      .from('document_versions')
      .select('r2_key, pdf_r2_key')
      .in('document_id', docs.map(d => d.id))
    if (versionsError) throw new Error(versionsError.message)

    for (const version of versions ?? []) {
      r2Keys.push(version.r2_key as string | null, version.pdf_r2_key as string | null)
    }
  }

  // Rows keyed by text matter_id (no FK cascade from matters). Errors are fatal:
  // aborting here leaves the matter intact and its files still present, which is
  // recoverable — the reverse is not.
  const scopedDeletes: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
    ['tabular_reviews', () => admin.from('tabular_reviews').delete().eq('matter_id', matterId)],
    ['matter_documents', () => admin.from('matter_documents').delete().eq('matter_id', matterId)],
    ['document_access_audit', () => admin.from('document_access_audit').delete().eq('matter_id', matterId)],
    ['matter_activity', () => admin.from('matter_activity').delete().eq('matter_id', matterId)],
    ['messages', () => admin.from('messages').delete().eq('matter_id', matterId)],
    ['matter_assistant_messages', () => admin.from('matter_assistant_messages').delete().eq('matter_id', matterId)],
    ['pipeline_aging_snooze', () => admin.from('pipeline_aging_snooze').delete().eq('entity', 'matter').eq('entity_id', matterId)],
    ['sms_messages', () => admin.from('sms_messages').delete().eq('matter_id', matterId)],
    ['calls', () => admin.from('calls').delete().eq('matter_id', matterId)],
    ['email_log', () => admin.from('email_log').delete().eq('matter_id', matterId)],
  ]

  for (const [table, run] of scopedDeletes) {
    const { error } = await run()
    if (error) throw new Error(`Failed to delete ${table} rows for matter ${matterId}: ${error.message}`)
  }

  const { error: deleteMatterError } = await admin.from('matters').delete().eq('id', matterId)
  if (deleteMatterError) throw new Error(deleteMatterError.message)

  const { error: intakeError } = await admin.from('client_intake').delete().eq('id', intakeId)
  if (intakeError) throw new Error(intakeError.message)

  // Every DB row is gone; the blobs are now unreachable, so failing to remove
  // one is a storage leak rather than a dangling reference. Best-effort.
  for (const key of r2Keys) {
    try {
      await deleteR2Key(key)
    } catch (error) {
      console.error(`[deleteMatter] failed to delete R2 object ${key}:`, error)
    }
  }

  return { matterId, intakeId }
}
