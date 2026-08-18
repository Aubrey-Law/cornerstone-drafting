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
 * The plan task a stage entry should adopt, or null when there is none.
 *
 * The SLA plan and the stage engine used to describe the same work twice — the
 * plan said "Draft full document package" for the drafting phase while the
 * engine fired "Draft documents — {client}" with the per-document checklist. Now
 * that both live in `public.tasks`, the stage entry attaches its checklist and
 * its soft target to the plan's own row instead of creating a second one.
 *
 * The candidate is the first unstarted, firm-owned plan task in the pipeline
 * stage being entered. A row already carrying a `stage_entered_at` is left
 * alone, so re-entering a stage (revisions round 2) fires a fresh task exactly
 * as it always did.
 */
async function findAdoptablePlanTask(
  admin: SupabaseClient,
  matterId: string,
  matterStage: string,
): Promise<{ id: string; hard_due_at: string | null } | null> {
  const { data } = await admin
    .from('tasks')
    .select('id, hard_due_at')
    .eq('matter_id', matterId)
    .eq('source', 'sla')
    .eq('phase', matterStage)
    .eq('owner', 'firm')
    .in('status', ['open', 'in_progress'])
    .is('stage_entered_at', null)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (data as { id: string; hard_due_at: string | null } | null) ?? null
}

/**
 * Task a matter's entry into an attorney-owned engine stage.
 *
 * Adopts the matching plan row when there is one, so the stage's checklist and
 * the plan's deadline end up on a single task; otherwise inserts a `tasks` row
 * with source = 'stage', idempotent on (matter_id, stage_key, stage_entered_at).
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

  const checklist = buildStageChecklist(template, context)

  // Re-firing on the same stage entry must stay a no-op. Checked before
  // adoption rather than relying on the upsert's ON CONFLICT, because adopting
  // a plan row into a key another task already holds would trip the unique
  // index instead of doing nothing.
  const { data: alreadyFired } = await admin
    .from('tasks')
    .select('id')
    .eq('matter_id', args.matterId)
    .eq('stage_key', engineStage)
    .eq('stage_entered_at', matter.stage_entered_at)
    .limit(1)
    .maybeSingle()
  if (alreadyFired) return

  const adoptable = await findAdoptablePlanTask(admin, args.matterId, args.matterStage)

  if (adoptable) {
    // The plan's own deadline wins where it has one: it is the date the firm
    // committed to, and it already accounts for whatever the matter has slipped.
    const { error: adoptError } = await admin
      .from('tasks')
      .update({
        stage_key: engineStage,
        stage_entered_at: matter.stage_entered_at,
        task_type: template.task.type,
        checklist,
        batch_tag: template.task.batch_tag ?? null,
        priority: template.task.priority ?? 'normal',
        soft_due_at: softDue.toISOString(),
        hard_due_at: adoptable.hard_due_at ?? (hardDue ? hardDue.toISOString() : null),
        // Stage work runs off the soft date; hard_due_at stays the SLA badge.
        due_at: softDue.toISOString(),
      })
      .eq('id', adoptable.id)
      // Nothing else may have claimed it between the read and the write.
      .is('stage_entered_at', null)

    if (adoptError) console.error('fireEngineStageTask (adopt):', adoptError.message)
    else return
  }

  const { error } = await admin.from('tasks').upsert(
    {
      matter_id: args.matterId,
      source: 'stage',
      stage_key: engineStage,
      // Keeps a stage task in the same phase vocabulary the plan groups by.
      phase: args.matterStage,
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
      checklist,
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

  // Not filtered by source: the open task for this stage may be a plan row the
  // stage entry adopted, and a mid-stage flag change has to reach that too.
  // Newest first and capped at one, since a matter that has been through the
  // stage twice can have an older adopted row still open alongside the current
  // task, and reconciling the stale one would be wrong.
  const { data: task } = await admin
    .from('tasks')
    .select('id, checklist')
    .eq('matter_id', matterId)
    .eq('stage_key', engineStage)
    .eq('status', 'open')
    .order('stage_entered_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (!task) return

  const context = await loadGateContext(admin, matterId)
  const existing = Array.isArray(task.checklist) ? (task.checklist as StageChecklistItem[]) : []
  const next = reconcileStageChecklist(template, existing, context)

  if (JSON.stringify(next) === JSON.stringify(existing)) return

  const { error } = await admin.from('tasks').update({ checklist: next }).eq('id', task.id)
  if (error) console.error('reconcileEngineStageTask:', error.message)
}

/**
 * Close out a stage's open task when the matter leaves it.
 *
 * Restricted to source = 'stage' on purpose. A plan row the stage adopted is
 * still the firm's commitment for that phase — leaving the stage with the work
 * unfinished is exactly the case the plan exists to keep visible.
 */
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
