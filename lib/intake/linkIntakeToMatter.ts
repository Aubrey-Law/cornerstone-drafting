import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { promoteIntakeDocumentsToMatter } from '@/lib/intake/promoteIntakeDocuments'

type AdminClient = SupabaseClient<Database>

/** Persist matters.client_intake_id for the household intake being edited. */
export async function linkIntakeToMatter(
  admin: AdminClient,
  matterId: string | null | undefined,
  intakeId: string,
): Promise<void> {
  if (!matterId) return

  const { error } = await admin
    .from('matters')
    .update({ client_intake_id: intakeId })
    .eq('id', matterId)

  if (error) throw new Error(error.message)

  await promoteIntakeDocumentsToMatter(admin, intakeId, matterId).catch((err) => {
    console.error('[linkIntakeToMatter] promote intake documents failed:', err)
  })
}
