import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  computeMatterEstateSnapshot,
  EMPTY_MATTER_ESTATE_SNAPSHOT,
  type MatterEstateAsset,
  type MatterEstateSnapshot,
} from '@/lib/assets/matterEstateSnapshot'
import type { MatterAgingHealth } from '@/lib/queries/pipelineAging'

export interface MatterAgingSummary {
  currentStage: string
  stageEnteredAt: string
  daysInStage: number
  slaDays: number | null
  health: MatterAgingHealth | null
  isSnoozed: boolean
}

export async function fetchMatterAgingSummary(matterId: string): Promise<MatterAgingSummary | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('v_matter_aging')
    .select('current_stage, stage_entered_at, days_in_stage, sla_days, health, is_snoozed')
    .eq('id', matterId)
    .maybeSingle()

  if (error || !data) return null
  const health = data.health as MatterAgingHealth | null
  return {
    currentStage: String(data.current_stage ?? ''),
    stageEnteredAt: String(data.stage_entered_at ?? ''),
    daysInStage: Number(data.days_in_stage) || 0,
    slaDays: data.sla_days == null ? null : Number(data.sla_days),
    health: health === 'red' || health === 'amber' || health === 'green' ? health : null,
    isSnoozed: Boolean(data.is_snoozed),
  }
}

export async function fetchMatterEstateSnapshot(
  intakeId: string | null,
): Promise<MatterEstateSnapshot> {
  if (!intakeId) return EMPTY_MATTER_ESTATE_SNAPSHOT
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('asset_intake')
    .select('category, value, details, updated_at')
    .eq('client_intake_id', intakeId)

  if (error) {
    console.warn('Matter estate snapshot unavailable:', error.message)
    return EMPTY_MATTER_ESTATE_SNAPSHOT
  }
  return computeMatterEstateSnapshot((data ?? []) as MatterEstateAsset[])
}
