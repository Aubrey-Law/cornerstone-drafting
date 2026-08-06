import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AdminClient = SupabaseClient<Database>

/** Copy intake questionnaire uploads into the matter intake folder (idempotent). */
export async function promoteIntakeDocumentsToMatter(
  admin: AdminClient,
  intakeId: string,
  matterId: string,
): Promise<number> {
  const { data: docs, error } = await admin
    .from('intake_documents')
    .select('r2_key, name, size, content_type, uploaded_by, created_at')
    .eq('client_intake_id', intakeId)

  if (error) throw new Error(error.message)
  if (!docs?.length) return 0

  let inserted = 0
  for (const doc of docs) {
    const { error: insertError } = await admin
      .from('matter_documents')
      .insert({
        matter_id: matterId,
        r2_key: doc.r2_key,
        name: doc.name,
        size: doc.size,
        content_type: doc.content_type,
        folder: 'intake',
        source: 'client',
        shared_at: null,
        uploaded_by: doc.uploaded_by,
        created_at: doc.created_at,
      })

    if (!insertError) {
      inserted += 1
      continue
    }
    // r2_key is unique — skip rows already promoted.
    if (insertError.code === '23505') continue
    throw new Error(insertError.message)
  }

  return inserted
}
