import { fetchDesignSheet, fetchIntakeForMatter } from '@/lib/queries'
import { buildDesignSheetPersistencePayload } from '@/lib/designSheetPersistence'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  buildIntakeSeedPayload,
  isDesignSheetUnseeded,
} from '@/lib/designSheet/seedFromIntake'

import type { DesignSheet } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

export interface EnsureDesignSheetSeedContext {
  sheet?: DesignSheet | null
  intake?: IntakeSnapshot | null
}

/**
 * One-time seed: copy client intake into an empty design sheet.
 * Returns true when a seed write occurred.
 */
export async function ensureDesignSheetSeededFromIntake(
  matterId: string,
  context: EnsureDesignSheetSeedContext = {},
): Promise<boolean> {
  const admin = getAdminClient()
  const [sheet, intake] = await Promise.all([
    context.sheet !== undefined ? Promise.resolve(context.sheet) : fetchDesignSheet(matterId),
    context.intake !== undefined ? Promise.resolve(context.intake) : fetchIntakeForMatter(matterId),
  ])

  if (!intake?.first_name) return false

  const seedPayload = buildDesignSheetPersistencePayload(buildIntakeSeedPayload(intake))
  const now = new Date().toISOString()

  if (sheet?.id) {
    if (!isDesignSheetUnseeded(sheet)) return false

    const { error } = await admin
      .from('design_sheets')
      .update({
        ...seedPayload,
        updated_at: now,
      })
      .eq('id', sheet.id)

    if (error) throw new Error(error.message)
    return true
  }

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (matterError) throw new Error(matterError.message)
  if (!matter?.client_intake_id) return false

  const { error: insertError } = await admin
    .from('design_sheets')
    .insert({
      matter_id: matterId,
      client_intake_id: matter.client_intake_id,
      version: 1,
      status: 'draft',
      ...seedPayload,
      updated_at: now,
    })

  if (insertError) throw new Error(insertError.message)
  return true
}
