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
