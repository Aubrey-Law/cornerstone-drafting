import { fetchDesignSheet, fetchIntakeForMatter } from '@/lib/queries'
import { buildDesignSheetPersistencePayload } from '@/lib/designSheetPersistence'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  buildIntakeSeedDecisions,
  buildIntakeSeedPayload,
  isDesignSheetUnseeded,
} from '@/lib/designSheet/seedFromIntake'

import type { DesignSheet } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

export interface EnsureDesignSheetSeedContext {
  sheet?: DesignSheet | null
  intake?: IntakeSnapshot | null
}

async function assertHiredMatter(matterId: string): Promise<void> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matters')
    .select('relationship_status')
    .eq('id', matterId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.relationship_status !== 'hired') {
    throw new Error('Drafting is available only for hired matters.')
  }
}

async function ensureBlankDesignSheet(
  matterId: string,
  existingSheet: DesignSheet | null | undefined,
): Promise<boolean> {
  if (existingSheet?.id) return false

  const admin = getAdminClient()
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (matterError) throw new Error(matterError.message)
  if (!matter?.client_intake_id) return false

  // ignoreDuplicates: a concurrent seeder winning the race is success, not an
  // error — design_sheets_matter_id_version_key serializes us.
  const { error: insertError } = await admin
    .from('design_sheets')
    .upsert(
      {
        matter_id: matterId,
        client_intake_id: matter.client_intake_id,
        version: 1,
        status: 'draft',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'matter_id,version', ignoreDuplicates: true },
    )

  if (insertError) throw new Error(insertError.message)
  return true
}

/**
 * One-time seed: copy client intake into an empty design sheet.
 * Returns true when a seed write occurred.
 * Always ensures a design_sheets row exists when the matter has client_intake_id,
 * so the drafting workspace can open even if intake seed data is incomplete.
 */
export async function ensureDesignSheetSeededFromIntake(
  matterId: string,
  context: EnsureDesignSheetSeedContext = {},
): Promise<boolean> {
  await assertHiredMatter(matterId)
  const admin = getAdminClient()
  const [sheet, intake] = await Promise.all([
    context.sheet !== undefined ? Promise.resolve(context.sheet) : fetchDesignSheet(matterId),
    context.intake !== undefined ? Promise.resolve(context.intake) : fetchIntakeForMatter(matterId),
  ])

  if (!intake?.first_name) {
    return ensureBlankDesignSheet(matterId, sheet)
  }

  const now = new Date().toISOString()

  if (sheet?.id) {
    if (!isDesignSheetUnseeded(sheet)) return false

    const seedDecisions = buildIntakeSeedDecisions(intake, sheet.decisions)
    const mergedSeedPayload = buildDesignSheetPersistencePayload({
      ...sheet,
      ...buildIntakeSeedPayload(intake),
      ...(seedDecisions ? { decisions: seedDecisions } : {}),
    })

    const { error } = await admin
      .from('design_sheets')
      .update({
        ...mergedSeedPayload,
        updated_at: now,
      })
      .eq('id', sheet.id)

    if (error) {
      // Sheet exists — do not block the workspace on a seed-column mismatch.
      console.error('design sheet seed update failed:', error.message)
      return false
    }
    return true
  }

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (matterError) throw new Error(matterError.message)
  if (!matter?.client_intake_id) return false

  const insertSeedDecisions = buildIntakeSeedDecisions(intake, null)
  const insertSeedPayload = buildDesignSheetPersistencePayload({
    ...buildIntakeSeedPayload(intake),
    ...(insertSeedDecisions ? { decisions: insertSeedDecisions } : {}),
  })

  const { error: insertError } = await admin
    .from('design_sheets')
    .upsert(
      {
        matter_id: matterId,
        client_intake_id: matter.client_intake_id,
        version: 1,
        status: 'draft',
        ...insertSeedPayload,
        updated_at: now,
      },
      { onConflict: 'matter_id,version', ignoreDuplicates: true },
    )

  if (insertError) {
    console.error('design sheet seed insert failed:', insertError.message)
    // Fall back to a blank sheet so /admin/drafting/[matterId] can still load.
    return ensureBlankDesignSheet(matterId, null)
  }
  return true
}
