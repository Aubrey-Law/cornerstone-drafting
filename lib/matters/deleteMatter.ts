import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteR2Key } from '@/lib/r2Delete'

/** Permanently delete a matter, its intake, documents (DB + best-effort R2), and related rows. */
export async function deleteMatter(admin: SupabaseClient, matterId: string) {
  const { data: matter, error: fetchError } = await admin
    .from('matters')
    .select('id, client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!matter) throw new Error('Matter not found')

  const intakeId = matter.client_intake_id as string

  const { data: docs } = await admin
    .from('matter_documents')
    .select('id, r2_key')
    .eq('matter_id', matterId)

  if (docs?.length) {
    const docIds = docs.map(d => d.id)
    const { data: versions } = await admin
      .from('document_versions')
      .select('r2_key, pdf_r2_key')
      .in('document_id', docIds)

    for (const doc of docs) await deleteR2Key(doc.r2_key as string | null)
    for (const version of versions ?? []) {
      await deleteR2Key(version.r2_key as string | null)
      await deleteR2Key(version.pdf_r2_key as string | null)
    }
  }

  // Rows keyed by text matter_id (no FK cascade from matters).
  await admin.from('tabular_reviews').delete().eq('matter_id', matterId)
  await admin.from('matter_documents').delete().eq('matter_id', matterId)
  await admin.from('document_access_audit').delete().eq('matter_id', matterId)
  await admin.from('matter_activity').delete().eq('matter_id', matterId)
  await admin.from('messages').delete().eq('matter_id', matterId)
  await admin.from('matter_assistant_messages').delete().eq('matter_id', matterId)
  await admin.from('pipeline_aging_snooze').delete().eq('entity', 'matter').eq('entity_id', matterId)
  await admin.from('sms_messages').delete().eq('matter_id', matterId)
  await admin.from('calls').delete().eq('matter_id', matterId)
  await admin.from('email_log').delete().eq('matter_id', matterId)

  const { error: deleteMatterError } = await admin.from('matters').delete().eq('id', matterId)
  if (deleteMatterError) throw new Error(deleteMatterError.message)

  const { error: intakeError } = await admin.from('client_intake').delete().eq('id', intakeId)
  if (intakeError) throw new Error(intakeError.message)

  return { matterId, intakeId }
}
