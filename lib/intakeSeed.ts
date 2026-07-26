import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'

export interface BuildIntakeSyncJobsInput {
  intakeId: string
  matterId: string | null
  reviewFlags: IntakeReadinessFlag[]
}

/**
 * Seed design sheet from intake and persist attorney review flags.
 * Cornerstone Lite runs seed inline (no intake_sync_jobs outbox).
 */
export async function seedDesignSheetAndJobs(
  admin: SupabaseClient<Database>,
  input: BuildIntakeSyncJobsInput,
): Promise<void> {
  if (!input.matterId) return

  // Must match the canonical reader ordering in the design-sheet route
  // (fetchDesignSheetRow): newest version wins. `.maybeSingle()` without
  // `.limit(1)` *errors* when more than one row exists, and swallowing that
  // error made this insert a fresh version-1 sheet on every intake submit —
  // an unbounded duplicate cascade.
  const { data: existingSheet, error: existingSheetError } = await admin
    .from('design_sheets')
    .select('id')
    .eq('matter_id', input.matterId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingSheetError) throw new Error(existingSheetError.message)

  const flagsPayload = {
    intake_review_flags: input.reviewFlags,
    updated_at: new Date().toISOString(),
  }

  if (existingSheet?.id) {
    const { error: updateError } = await admin
      .from('design_sheets')
      .update({ ...flagsPayload, client_intake_id: input.intakeId })
      .eq('id', existingSheet.id)
    if (updateError) throw new Error(updateError.message)
  } else {
    // Concurrent seeding (client submits intake while an attorney opens the
    // workspace) is serialized by design_sheets_matter_id_version_key.
    const { error: insertError } = await admin
      .from('design_sheets')
      .upsert(
        {
          matter_id: input.matterId,
          client_intake_id: input.intakeId,
          version: 1,
          status: 'draft',
          ...flagsPayload,
        },
        { onConflict: 'matter_id,version', ignoreDuplicates: true },
      )
    if (insertError) throw new Error(insertError.message)
  }

  try {
    await ensureDesignSheetSeededFromIntake(input.matterId)
  } catch (error) {
    console.error('[intake seed] design sheet seed failed:', error)
  }
}
