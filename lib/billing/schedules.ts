import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'

export const manualMilestoneSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  trigger: z.string().trim().min(1).default('manual'),
  terms: z.string().trim().min(1).default('Due on receipt'),
  amount_cents: z.number().int().positive(),
})

export const createFeeScheduleSchema = z.object({
  packageId: z.string().uuid(),
  agreedTotalCents: z.number().int().positive(),
  manualMilestones: z.array(manualMilestoneSchema).min(1).max(12).optional(),
})

export function splitExactlyInCents(totalCents: number): [number, number] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 1) {
    throw new Error('The agreed fee must be at least two cents')
  }
  const first = Math.floor(totalCents / 2)
  return [first, totalCents - first]
}
function generatedAdmin(): SupabaseClient<GeneratedDatabase> {
  // New billing services use the checked-in generated contract at the boundary.
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

export async function createMatterFeeSchedule(input: {
  matterId: string
  packageId: string
  agreedTotalCents: number
  actorId: string
  manualMilestones?: z.infer<typeof manualMilestoneSchema>[]
}) {
  const admin = generatedAdmin()
  const { data, error } = await admin.rpc('create_matter_fee_schedule', {
    p_matter_id: input.matterId,
    p_package_id: input.packageId,
    p_agreed_total_cents: input.agreedTotalCents,
    p_actor_id: input.actorId,
    p_manual_milestones: input.manualMilestones ?? null,
  } as never)
  if (error) throw new Error(error.message)
  return data
}

export async function releaseMatterFeeMilestone(milestoneId: string, actorId: string) {
  const admin = generatedAdmin()
  const { data, error } = await admin.rpc('release_matter_fee_milestone', {
    p_milestone_id: milestoneId,
    p_actor_id: actorId,
  } as never)
  if (error) throw new Error(error.message)
  return data
}

/** A milestone as the matter Billing tab renders it. */
export interface FeeMilestoneRow {
  id: string
  milestoneKey: string
  label: string
  triggerKey: string
  terms: string
  position: number
  amountCents: number
  state: 'scheduled' | 'ready' | 'invoiced' | 'paid' | 'waived'
  releasedAt: string | null
  billingItemId: string | null
}

/** A matter's agreed fee, split into the milestones that bill it. */
export interface MatterFeeScheduleView {
  id: string
  agreedTotalCents: number
  state: 'active' | 'completed' | 'cancelled'
  packageName: string | null
  billingStrategy: string | null
  createdAt: string
  milestones: FeeMilestoneRow[]
}

/** An active package the attach dialog can offer. */
export interface ServicePackageOption {
  id: string
  name: string
  practiceArea: string
  billingStrategy: string
  milestones: { label: string; percentageBps: number | null; position: number }[]
}

/**
 * Milestone billing ships dark: the schema, RPCs and stage triggers are all in
 * place, but nothing offers a schedule until the firm turns this on. Mirrors
 * `durableWorkflowJobsEnabled` in lib/workflowJobs.ts.
 */
export async function billingMilestonesEnabled(): Promise<boolean> {
  const { data, error } = await getAdminClient().from('firm_settings')
    .select('billing_milestones_enabled').eq('id', 1).maybeSingle()
  return !error && data?.billing_milestones_enabled === true
}

/** One matter's fee schedule with its milestones in billing order, or null. */
export async function fetchMatterFeeSchedule(
  matterId: string,
): Promise<MatterFeeScheduleView | null> {
  const admin = generatedAdmin()
  const { data: schedule, error } = await admin
    .from('matter_fee_schedules')
    .select('id, agreed_total_cents, state, package_snapshot, created_at')
    .eq('matter_id', matterId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!schedule) return null

  const { data: milestones, error: milestoneError } = await admin
    .from('matter_fee_milestones')
    .select('id, milestone_key, label, trigger_key, terms, position, amount_cents, state, released_at, billing_item_id')
    .eq('schedule_id', schedule.id)
    .order('position', { ascending: true })
  if (milestoneError) throw new Error(milestoneError.message)

  // The snapshot is the package as it stood when the matter signed, so a later
  // package edit never restates an agreed fee.
  const snapshot = (schedule.package_snapshot ?? {}) as Record<string, unknown>
  return {
    id: schedule.id,
    agreedTotalCents: schedule.agreed_total_cents,
    state: schedule.state as MatterFeeScheduleView['state'],
    packageName: typeof snapshot.name === 'string' ? snapshot.name : null,
    billingStrategy: typeof snapshot.billing_strategy === 'string' ? snapshot.billing_strategy : null,
    createdAt: schedule.created_at,
    milestones: (milestones ?? []).map((row): FeeMilestoneRow => ({
      id: row.id,
      milestoneKey: row.milestone_key,
      label: row.label,
      triggerKey: row.trigger_key,
      terms: row.terms,
      position: row.position,
      amountCents: row.amount_cents,
      state: row.state as FeeMilestoneRow['state'],
      releasedAt: row.released_at,
      billingItemId: row.billing_item_id,
    })),
  }
}

/**
 * Packages offered when attaching a schedule. Only `fixed_milestones` is
 * offered: `legal_plan` is rejected by `create_matter_fee_schedule`, and
 * `manual_phases` (probate) needs per-phase amounts that no UI collects yet.
 */
export async function fetchAttachableServicePackages(): Promise<ServicePackageOption[]> {
  const admin = generatedAdmin()
  const { data, error } = await admin
    .from('service_packages')
    .select('id, name, practice_area, billing_strategy, service_package_milestones(label, percentage_bps, position)')
    .eq('is_active', true)
    .eq('billing_strategy', 'fixed_milestones')
    .order('practice_area', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row): ServicePackageOption => ({
    id: row.id,
    name: row.name,
    practiceArea: row.practice_area,
    billingStrategy: row.billing_strategy,
    milestones: [...(row.service_package_milestones ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(milestone => ({
        label: milestone.label,
        percentageBps: milestone.percentage_bps,
        position: milestone.position,
      })),
  }))
}
