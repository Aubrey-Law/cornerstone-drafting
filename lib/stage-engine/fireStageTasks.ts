import type { SupabaseClient } from '@supabase/supabase-js'
import { mapMatterStageToEngine } from '@/lib/stage-engine/labels'
import { addBusinessDays } from '@/lib/stage-engine/businessDays'
import { buildPlanGateContext } from '@/lib/stage-engine/planGateContext'
import {
  buildStageChecklist,
  findStageTaskTemplate,
  gatePasses,
  reconcileStageChecklist,
  type PlanGateContext,
  type StageChecklistItem,
} from '@/lib/stage-engine/stageTaskTemplates'
import { UNTASKED_ENGINE_KEYS } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { DesignSheet } from '@/types/database'

const UNTASKED = new Set<string>(UNTASKED_ENGINE_KEYS)

/**
 * Which engine keys fire a task: everything with a template that is not on the
 * deliberately-untasked list. Derived rather than restated, so adding a
 * template is all it takes to task a stage.
 */
export function firesAttorneyTask(engineStage: string): boolean {
  if (UNTASKED.has(engineStage)) return false
  return findStageTaskTemplate(engineStage) !== null
}

async function loadGateContext(
  admin: SupabaseClient,
  matterId: string,
): Promise<PlanGateContext> {
  const [details, sheet] = await Promise.all([
    admin.from('matter_details').select('*').eq('client_id', matterId).maybeSingle(),
    admin
      .from('design_sheets')
      .select('plan_type, spouse_trust_name, pet_care_option, children, assets')
      .eq('matter_id', matterId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return buildPlanGateContext(
    (details.data ?? null) as MatterDetailsRow | null,
    (sheet.data ?? null) as Partial<DesignSheet> | null,
  )
}

/**
 * Create a `tasks` row (source = 'stage') when a matter enters an attorney-owned
 * engine stage. Idempotent on (matter_id, stage_key, stage_entered_at).
 */
export async function fireEngineStageTask(
  admin: SupabaseClient,
  args: {
    matterId: string
    matterStage: string
    clientName?: string | null
    revisionRound?: number
  },
): Promise<void> {
  const engineStage = mapMatterStageToEngine(args.matterStage)
  if (!engineStage || !firesAttorneyTask(engineStage)) return

  const { data: matter } = await admin
    .from('matters')
    .select('stage_entered_at, client_name, revision_round')
    .eq('id', args.matterId)
    .maybeSingle()

  if (!matter?.stage_entered_at) return

  const template = findStageTaskTemplate(engineStage)
  if (!template) return

  const context = await loadGateContext(admin, args.matterId)
  // A template can gate itself: trust funding has nothing to do on a will plan.
  if (!gatePasses(template.gate, context)) return

  const clientName = args.clientName ?? matter.client_name ?? 'Client'
  const reviewRound = String(args.revisionRound ?? matter.revision_round ?? 1)
  const title = template.task.title
    .replace('{client_name}', clientName)
    .replace('{review_round}', reviewRound)
    .replace('{matter_id}', args.matterId)

  const enteredAt = new Date(matter.stage_entered_at as string)
  const softDue = addBusinessDays(enteredAt, template.task.soft_lead_days)
  // Funding has a null SLA on purpose — a matter waiting on a county clerk
  // should not sit permanently red for a delay nobody at the firm can act on.
  const hardDue = template.task.sla_days === null
    ? null
    : addBusinessDays(enteredAt, template.task.sla_days)

  const { error } = await admin.from('tasks').upsert(
    {
      matter_id: args.matterId,
      source: 'stage',
      stage_key: engineStage,
      stage_entered_at: matter.stage_entered_at,
      title,
      task_type: template.task.type,
      soft_due_at: softDue.toISOString(),
      hard_due_at: hardDue ? hardDue.toISOString() : null,
      // Stage tasks work off their soft date; hard_due_at stays the SLA badge.
      due_at: softDue.toISOString(),
      priority: template.task.priority ?? 'normal',
      status: 'open',
      batch_tag: template.task.batch_tag ?? null,
      checklist: buildStageChecklist(template, context),
    },
    { onConflict: 'matter_id,stage_key,stage_entered_at', ignoreDuplicates: true },
  )

  if (error) {
    console.error('fireEngineStageTask:', error.message)
  }
}

/**
 * Fold a mid-stage plan-flag change into the open stage task.
 *
 * Turning a flag on appends its items; turning it off removes only the ones
 * still incomplete. Completed work is never deleted — the flag being wrong
 * afterwards does not undo what was actually done.
 */
export async function reconcileEngineStageTask(
  admin: SupabaseClient,
  matterId: string,
  matterStage: string,
): Promise<void> {
  const engineStage = mapMatterStageToEngine(matterStage)
  if (!engineStage || !firesAttorneyTask(engineStage)) return

  const template = findStageTaskTemplate(engineStage)
  if (!template || template.task.type !== 'checklist') return

  const { data: task } = await admin
    .from('tasks')
    .select('id, checklist')
    .eq('matter_id', matterId)
    .eq('source', 'stage')
    .eq('stage_key', engineStage)
    .eq('status', 'open')
    .maybeSingle()

  if (!task) return

  const context = await loadGateContext(admin, matterId)
  const existing = Array.isArray(task.checklist) ? (task.checklist as StageChecklistItem[]) : []
  const next = reconcileStageChecklist(template, existing, context)

  if (JSON.stringify(next) === JSON.stringify(existing)) return

  const { error } = await admin.from('tasks').update({ checklist: next }).eq('id', task.id)
  if (error) console.error('reconcileEngineStageTask:', error.message)
}

export async function archiveEngineStageTasks(
  admin: SupabaseClient,
  matterId: string,
  engineStage: string,
): Promise<void> {
  await admin
    .from('tasks')
    .update({ status: 'archived' })
    .eq('matter_id', matterId)
    .eq('source', 'stage')
    .eq('stage_key', engineStage)
    .eq('status', 'open')
}
