import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import type {
  DailyPlanPreview,
  PlanLane,
  PriorityBand,
  PriorityReasonCode,
  WorkItem,
  WorkSourceType,
} from '@/lib/work/types'

export type DailyPlanStatus = 'draft' | 'committed' | 'closed'
export type DailyPlanItemStatus = 'planned' | 'started' | 'completed' | 'skipped'

export interface StoredDailyPlanItem {
  id: string
  plan_id: string
  work_key: string
  source_type: WorkSourceType
  record_type: 'lead' | 'matter' | 'firm'
  record_id: string | null
  lane: PlanLane
  position: number
  estimate_minutes: number
  priority_band: PriorityBand
  reason_codes: PriorityReasonCode[]
  block_start: string | null
  block_end: string | null
  status: DailyPlanItemStatus
  completed_at: string | null
}

export interface StoredDailyPlan {
  id: string
  user_id: string
  plan_date: string
  status: DailyPlanStatus
  capacity_minutes: number
  planned_minutes: number
  interruption_buffer_percent: number
  generated_at: string
  committed_at: string | null
  closed_at: string | null
  items: StoredDailyPlanItem[]
}

function laneRows(preview: DailyPlanPreview): Array<{ lane: PlanLane; item: WorkItem }> {
  return [
    ...preview.mustDo.map(item => ({ lane: 'must_do' as const, item })),
    ...preview.communication.map(item => ({ lane: 'communication' as const, item })),
    ...preview.suggested.map(item => ({ lane: 'suggested' as const, item })),
    ...preview.later.map(item => ({ lane: 'later' as const, item })),
  ]
}

export async function saveDailyPlan(input: {
  userId: string
  preview: DailyPlanPreview
  interruptionBufferPercent: number
}): Promise<StoredDailyPlan> {
  const admin = getAdminClient()
  const { data: plan, error: planError } = await admin
    .from('daily_plans')
    .upsert({
      user_id: input.userId,
      plan_date: input.preview.date,
      status: 'draft',
      capacity_minutes: input.preview.capacityMinutes,
      planned_minutes: input.preview.plannedMinutes,
      interruption_buffer_percent: input.interruptionBufferPercent,
      generated_at: new Date().toISOString(),
      committed_at: null,
      closed_at: null,
    }, { onConflict: 'user_id,plan_date' })
    .select('*')
    .single()
  if (planError || !plan) throw new Error(planError?.message ?? 'Unable to save the daily plan')

  const planId = plan.id as string
  const { data: previousRows, error: previousError } = await admin.from('daily_plan_items')
    .select('*').eq('plan_id', planId).order('position')
  if (previousError) throw new Error(previousError.message)
  const previous = (previousRows ?? []) as unknown as StoredDailyPlanItem[]
  const previousByKey = new Map(previous.map(item => [item.work_key, item]))
  const { error: deleteError } = await admin.from('daily_plan_items').delete().eq('plan_id', planId)
  if (deleteError) throw new Error(deleteError.message)

  const blocks = new Map(input.preview.blocks.map(block => [block.workKey, block]))
  const communicationBlock = blocks.get('batch:communications')
  let communicationBlockAssigned = false
  const rows = laneRows(input.preview).map(({ lane, item }, position) => {
    const block = blocks.get(item.workKey)
      ?? (lane === 'communication' && !communicationBlockAssigned ? communicationBlock : undefined)
    if (lane === 'communication' && block === communicationBlock) communicationBlockAssigned = true
    const old = previousByKey.get(item.workKey)
    return {
      plan_id: planId,
      work_key: item.workKey,
      source_type: item.sourceType,
      record_type: item.record.type,
      record_id: item.record.id ?? null,
      lane,
      position,
      estimate_minutes: item.estimateMinutes,
      priority_band: item.priorityBand,
      reason_codes: item.priorityReasons.map(reason => reason.code),
      block_start: block?.startAt ?? null,
      block_end: block?.endAt ?? null,
      status: old?.status ?? 'planned',
      completed_at: old?.completed_at ?? null,
    }
  })
  const currentKeys = new Set(rows.map(row => row.work_key))
  // A source can temporarily disappear during an integration outage or after
  // a user starts it. Replanning must not silently erase that commitment.
  for (const old of previous) {
    if (currentKeys.has(old.work_key) || old.status === 'completed') continue
    rows.push({
      plan_id: planId,
      work_key: old.work_key,
      source_type: old.source_type,
      record_type: old.record_type,
      record_id: old.record_id,
      lane: 'later',
      position: rows.length,
      estimate_minutes: old.estimate_minutes,
      priority_band: old.priority_band,
      reason_codes: old.reason_codes,
      block_start: null,
      block_end: null,
      status: old.status,
      completed_at: old.completed_at,
    })
  }
  if (rows.length) {
    const { error: insertError } = await admin.from('daily_plan_items').insert(rows)
    if (insertError) throw new Error(insertError.message)
  }
  return (await fetchDailyPlan(input.userId, input.preview.date)) as StoredDailyPlan
}

export async function fetchDailyPlan(userId: string, date: string): Promise<StoredDailyPlan | null> {
  const admin = getAdminClient()
  const { data: plan, error } = await admin
    .from('daily_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', date)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!plan) return null
  const { data: items, error: itemsError } = await admin
    .from('daily_plan_items')
    .select('*')
    .eq('plan_id', plan.id)
    .order('position')
  if (itemsError) throw new Error(itemsError.message)
  return { ...(plan as unknown as Omit<StoredDailyPlan, 'items'>), items: (items ?? []) as unknown as StoredDailyPlanItem[] }
}

export async function fetchDailyPlanById(userId: string, planId: string): Promise<StoredDailyPlan | null> {
  const admin = getAdminClient()
  const { data: plan, error } = await admin
    .from('daily_plans')
    .select('*')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!plan) return null
  const { data: items, error: itemsError } = await admin
    .from('daily_plan_items')
    .select('*')
    .eq('plan_id', plan.id)
    .order('position')
  if (itemsError) throw new Error(itemsError.message)
  return { ...(plan as unknown as Omit<StoredDailyPlan, 'items'>), items: (items ?? []) as unknown as StoredDailyPlanItem[] }
}

export async function updateDailyPlan(input: {
  userId: string
  planId: string
  status?: DailyPlanStatus
  order?: string[]
  item?: { workKey: string; status: DailyPlanItemStatus }
}): Promise<StoredDailyPlan> {
  const admin = getAdminClient()
  const { data: owned, error: ownedError } = await admin
    .from('daily_plans')
    .select('id, plan_date')
    .eq('id', input.planId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (ownedError) throw new Error(ownedError.message)
  if (!owned) throw new Error('Daily plan not found')

  if (input.status) {
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { status: input.status }
    if (input.status === 'committed') patch.committed_at = now
    if (input.status === 'closed') patch.closed_at = now
    const { error } = await admin.from('daily_plans').update(patch).eq('id', input.planId)
    if (error) throw new Error(error.message)
  }

  if (input.item) {
    const { error } = await admin.from('daily_plan_items').update({
      status: input.item.status,
      completed_at: input.item.status === 'completed' ? new Date().toISOString() : null,
    }).eq('plan_id', input.planId).eq('work_key', input.item.workKey)
    if (error) throw new Error(error.message)
  }

  if (input.order?.length) {
    // Move away from the unique (plan_id, position) range first so swaps do not
    // conflict halfway through the update.
    for (let index = 0; index < input.order.length; index++) {
      const { error } = await admin.from('daily_plan_items')
        .update({ position: 10_000 + index })
        .eq('plan_id', input.planId)
        .eq('work_key', input.order[index])
      if (error) throw new Error(error.message)
    }
    for (let index = 0; index < input.order.length; index++) {
      const { error } = await admin.from('daily_plan_items')
        .update({ position: index })
        .eq('plan_id', input.planId)
        .eq('work_key', input.order[index])
      if (error) throw new Error(error.message)
    }
  }

  return (await fetchDailyPlan(input.userId, owned.plan_date as string)) as StoredDailyPlan
}
