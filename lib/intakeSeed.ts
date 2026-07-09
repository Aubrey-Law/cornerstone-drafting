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

  const { data: existingSheet } = await admin
    .from('design_sheets')
    .select('id')
    .eq('matter_id', input.matterId)
    .maybeSingle()

  const flagsPayload = {
    intake_review_flags: input.reviewFlags,
    updated_at: new Date().toISOString(),
  }

  if (existingSheet?.id) {
    await admin
      .from('design_sheets')
      .update({ ...flagsPayload, client_intake_id: input.intakeId })
      .eq('id', existingSheet.id)
  } else {
    await admin.from('design_sheets').insert({
      matter_id: input.matterId,
      client_intake_id: input.intakeId,
      version: 1,
      status: 'draft',
      ...flagsPayload,
    })
  }

  try {
    await ensureDesignSheetSeededFromIntake(input.matterId)
  } catch (error) {
    console.error('[intake seed] design sheet seed failed:', error)
  }
}
