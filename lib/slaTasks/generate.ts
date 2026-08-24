import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { archiveTasksForClosedRecord } from '@/lib/tasks/closeout'
import { POST_ENGAGEMENT_PHASES } from './types'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { planDateColumns, planTimestamp, toPlanTasks } from './plan'
import { fetchPlanTasks } from './queries'
import {
  buildPlanTaskDrafts,
  isDateKey,
  parseTemplateTasks,
  rescheduleForAnchor,
  templateSwapVerdict,
  type PlanTaskDraft,
} from './schedule'
import {
  PLAN_TASK_COLUMNS,
  type PlanTask,
  type SlaAnchorDates,
  type SlaClockAnchor,
  type SlaGate,
  type SlaTemplateRow,
  type SlaVariant,
} from './types'

export const ESTATE_PLANNING_SLA = 'estate_planning_sla'
export const ESTATE_PLANNING_SLA_V3 = 'estate_planning_sla_v3'
export const COLLEGE_PREP_SLA_V1 = 'college_prep_sla_v1'
export const PROBATE_SLA_V1 = 'probate_sla_v1'

/**
 * The checklist a practice area runs, or null when it has none.
 *
 * The College Preparation Plan gets its own rather than a trimmed estate one:
 * the estate checklist asks for a trust, deeds, funding, and a Certification of
 * Trust this plan never produces, and never asks the two questions that govern a
 * college plan — whether the student has turned 18, and when move-in is.
 *
 * Probate has a dedicated administration track rather than inheriting an
 * estate-planning checklist.
 */
export function slaTemplateForPracticeArea(practiceArea: unknown): string | null {
  const area = normalizePracticeArea(practiceArea)
  if (area === 'Probate') return PROBATE_SLA_V1
  if (area === 'CP') return COLLEGE_PREP_SLA_V1
  return ESTATE_PLANNING_SLA_V3
}

/** Columns on `matters` that anchor an SLA clock. */
const MATTER_ANCHOR_COLUMNS = 'id, discovery_call_at, pmps_at, engagement_signed_at, fit_decision'

interface MatterAnchorRow {
  id: string
  discovery_call_at: string | null
  pmps_at: string | null
  engagement_signed_at: string | null
  fit_decision: string | null
}

/** Timestamps become calendar day keys in the firm's timezone. */
function anchorsFromMatter(matter: MatterAnchorRow): SlaAnchorDates {
  return {
    engagement: matter.engagement_signed_at ? firmDateKey(matter.engagement_signed_at) : null,
    discovery_call: matter.discovery_call_at ? firmDateKey(matter.discovery_call_at) : null,
    pmps: matter.pmps_at ? firmDateKey(matter.pmps_at) : null,
  }
}

function gatesFromMatter(matter: MatterAnchorRow): SlaGate[] {
  return matter.fit_decision === 'fit' ? ['fit_confirmed'] : []
}

/**
 * One draft, as the columns `public.tasks` stores. The plan reasons in calendar
 * days; the table stores timestamps, so the conversion happens here, once, at
 * the write boundary — see `planTimestamp`.
 */
function planTaskInsert(draft: PlanTaskDraft): Record<string, unknown> {
  const due = planTimestamp(draft.due_date)
  return {
    matter_id: draft.matter_id,
    source: 'sla',
    status: 'open',
    priority: 'normal',
    task_type: 'single',
    title: draft.name,
    phase: draft.phase,
    owner: draft.owner,
    plan_template_id: draft.plan_template_id,
    sort_order: draft.sort_order,
    skill: draft.skill,
    plan_start_date: draft.start_date,
    // Nothing has adopted a freshly generated row, so its working due date and
    // its SLA are the same day; a stage entry later splits them.
    due_at: due,
    hard_due_at: due,
    nudge_at: planTimestamp(draft.nudge_date),
    nudge_tier: draft.nudge_tier,
    escalation_at: planTimestamp(draft.escalation_date),
    escalation_tier: draft.escalation_tier,
    due_offset_days: draft.due_offset_days,
    nudge_offset_days: draft.nudge_offset_days,
    escalation_offset_days: draft.escalation_offset_days,
    relative_to: draft.relative_to,
    pre_engagement: draft.pre_engagement,
    auto: draft.auto,
    conditional: draft.conditional,
    pauses_clock: draft.pauses_clock,
    gate: draft.gate,
    variant: draft.variant,
    extends_target_days: draft.extends_target_days,
    recurring_interval_days: draft.recurring_interval_days,
    triggers_day_zero: draft.triggers_day_zero,
  }
}

export type GenerateResult =
  | { ok: true; created: true; tasks: PlanTask[]; templateId: string }
  | {
      ok: true
      created: false
      reason: 'already_generated' | 'template_in_progress'
      tasks: PlanTask[]
    }
  | { ok: false; error: string; status: number }

interface GenerateOptions {
  matterId: string
  templateName?: string
  startDate?: string
  /** Discard any tasks already generated for this matter and start over. */
  replace?: boolean
  /**
   * Replace a checklist generated from a *different* template, but only while
   * every task is still untouched. Used when a matter's practice area turns out
   * to be something other than what its lead was opened as.
   */
  retemplate?: boolean
  /** Alternative branches to include, e.g. the remote-signing path. */
  variants?: SlaVariant[]
}

/** Load a template and coerce its JSONB task array into typed definitions. */
export async function loadSlaTemplate(
  admin: SupabaseClient,
  templateName: string,
): Promise<SlaTemplateRow | null> {
  const { data, error } = await admin
    .from('sla_task_templates')
    .select('id, template_name, description, target_days, target_days_pre_engagement, target_days_engagement, tasks, created_at, updated_at')
    .eq('template_name', templateName)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { ...data, tasks: parseTemplateTasks(data.tasks) } as SlaTemplateRow
}

/**
 * Instantiate an SLA template into `tasks` (source = 'sla') for one matter.
 *
 * Generation is a snapshot: later edits to the template never reach back into a
 * matter that has already been kicked off. Re-running is a no-op unless
 * `replace` is set, so the matter-creation hooks can fire more than once
 * (retries, a lead converted twice) without duplicating the checklist.
 */
export async function generateMatterTasks(
  admin: SupabaseClient,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { matterId, replace = false } = options
  const templateName = options.templateName?.trim() || ESTATE_PLANNING_SLA_V3
  const startDate = options.startDate?.trim() || firmTodayKey()

  if (!isDateKey(startDate)) {
    return { ok: false, error: 'start_date must be a calendar date (YYYY-MM-DD)', status: 400 }
  }

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select(MATTER_ANCHOR_COLUMNS)
    .eq('id', matterId)
    .maybeSingle<MatterAnchorRow>()
  if (matterError) return { ok: false, error: matterError.message, status: 500 }
  if (!matter) return { ok: false, error: 'Matter not found', status: 404 }

  let template: SlaTemplateRow | null
  try {
    template = await loadSlaTemplate(admin, templateName)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Template lookup failed', status: 500 }
  }
  if (!template) {
    return { ok: false, error: `No SLA template named "${templateName}"`, status: 404 }
  }
  if (template.tasks.length === 0) {
    return { ok: false, error: `Template "${templateName}" has no tasks`, status: 422 }
  }

  let existingTasks: PlanTask[]
  try {
    existingTasks = await fetchPlanTasks(admin, matterId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Task lookup failed', status: 500 }
  }
  if (existingTasks.length > 0) {
    const verdict = options.retemplate ? templateSwapVerdict(existingTasks, template.id) : 'same_template'
    if (!replace && verdict !== 'swap') {
      return {
        ok: true,
        created: false,
        reason: verdict === 'work_started' ? 'template_in_progress' : 'already_generated',
        tasks: existingTasks,
      }
    }
    // Only the generated plan is discarded. Stage-engine and hand-added tasks on
    // the same matter live in the same table now, and a template swap has no
    // business deleting them.
    const { error: deleteError } = await admin
      .from('tasks')
      .delete()
      .eq('matter_id', matterId)
      .eq('source', 'sla')
    if (deleteError) return { ok: false, error: deleteError.message, status: 500 }
  }

  const drafts = buildPlanTaskDrafts(template.tasks, {
    matterId,
    templateId: template.id,
    startDate,
    anchors: anchorsFromMatter(matter),
    gatesMet: gatesFromMatter(matter),
    variants: options.variants ?? [],
  })

  const { data: inserted, error: insertError } = await admin
    .from('tasks')
    .insert(drafts.map(planTaskInsert))
    .select(PLAN_TASK_COLUMNS)
  if (insertError) return { ok: false, error: insertError.message, status: 500 }

  const tasks = toPlanTasks((inserted ?? []) as unknown as Parameters<typeof toPlanTasks>[0]).sort(
    (a, b) => a.sort_order - b.sort_order,
  )
  return { ok: true, created: true, tasks, templateId: template.id }
}

/**
 * Kick off the SLA for a freshly created or freshly hired matter. Best-effort by
 * design: a matter must never fail to be created because its checklist could not
 * be written. Probate matters are skipped until a probate template exists.
 *
 * Idempotent, with one exception. A lead already carries the checklist it was
 * opened with, and a lead opened as an estate matter can convert as a College
 * Preparation Plan — the questionnaire, not the lead form, says what was sold.
 * `retemplate` lets that conversion swap the checklist for the right one while
 * nothing on it has been worked; see `templateSwapVerdict`.
 */
export async function ensureMatterSlaTasks(
  matterId: string,
  options: { practiceArea?: unknown; startDate?: string; retemplate?: boolean } = {},
): Promise<void> {
  try {
    if (normalizePracticeArea(options.practiceArea) === 'Probate') {
      const { data: settings } = await getAdminClient().from('firm_settings')
        .select('probate_track_enabled').eq('id', 1).maybeSingle()
      if (settings?.probate_track_enabled !== true) return
    }
    const templateName = slaTemplateForPracticeArea(options.practiceArea)
    if (!templateName) return
    const result = await generateMatterTasks(getAdminClient(), {
      matterId,
      templateName,
      startDate: options.startDate ?? firmTodayKey(),
      retemplate: options.retemplate === true,
    })
    if (!result.ok) {
      console.warn('[sla-tasks] generation skipped for matter', matterId, result.error)
    } else if (!result.created && result.reason === 'template_in_progress') {
      // Worth saying out loud: the matter is running a checklist of the wrong
      // shape, and it stays that way because someone has already worked it.
      console.warn(
        '[sla-tasks] matter',
        matterId,
        `is not on "${templateName}" and has tasks already worked; leaving its checklist alone`,
      )
    }
  } catch (e) {
    console.warn('[sla-tasks] generation failed for matter', matterId, e)
  }
}

/**
 * Kick off the SLA for a lead's opportunity.
 *
 * A lead already owns a `matters` row, so its checklist lives in the same place
 * a hired matter's does — there is no separate lead task engine. Almost every
 * task starts undated: the pre-engagement ones wait on the discovery call and
 * the PMPS date, and the Day-0 ones wait on the engagement signature. They still
 * belong on the plan, because the firm's next action is visible from the
 * checklist long before any of those dates exist.
 *
 * The practice area on the lead form picks the checklist. It is a statement of
 * intent rather than a decision — a lead can be opened as an estate matter and
 * convert as a College Preparation Plan — so conversion re-checks it.
 */
export async function ensureLeadSlaTasks(
  matterId: string,
  options: { practiceArea?: unknown } = {},
): Promise<void> {
  try {
    if (normalizePracticeArea(options.practiceArea) === 'Probate') {
      const { data: settings } = await getAdminClient().from('firm_settings')
        .select('probate_track_enabled').eq('id', 1).maybeSingle()
      if (settings?.probate_track_enabled !== true) return
    }
    const templateName = slaTemplateForPracticeArea(options.practiceArea) ?? ESTATE_PLANNING_SLA_V3
    const admin = getAdminClient()
    const result = await generateMatterTasks(admin, {
      matterId,
      templateName,
      startDate: firmTodayKey(),
    })
    if (!result.ok) {
      console.warn('[sla-tasks] lead generation skipped for matter', matterId, result.error)
      return
    }
    // The plan is generated whole and the unsold half is held back. A lead is
    // 11 pre-engagement tasks and 37 that depend on an engagement nobody has
    // signed; generating all 48 into the queue is what put 709 undoable tasks
    // across 39 leads on 2026-08-24. Archived rather than never created, so the
    // dated plan the Plan view reads stays whole and conversion is a restore
    // rather than a second generation that would have to reconcile.
    const held = await archiveTasksForClosedRecord(
      admin,
      { matterId },
      'not_engaged',
      {},
      { phases: POST_ENGAGEMENT_PHASES, logActivity: false },
    )
    if (held === null) {
      console.warn('[sla-tasks] post-engagement hold-back failed for matter', matterId)
    }
  } catch (e) {
    console.warn('[sla-tasks] lead generation failed for matter', matterId, e)
  }
}

export type SlaTemplateResync =
  /** The practice area has no template of its own (Probate). */
  | 'skipped'
  /** Nothing generated yet. This never creates a checklist — see below. */
  | 'no_checklist'
  | 'unchanged'
  | 'swapped'
  /** On the wrong template, but someone has already worked it. */
  | 'work_started'
  | 'failed'

/**
 * Move a matter already carrying a checklist onto the one its practice area
 * calls for. Safe to call on every load: it does nothing in the common case.
 *
 * This exists because the checklist is otherwise chosen once, at creation or at
 * lead conversion, from whatever the practice area was *then*. A matter
 * reclassified afterwards keeps the old checklist for life — the College
 * Preparation Plan matters that predate `college_prep_sla_v1` were all running
 * the estate checklist, asking for a trust and deeds they will never produce.
 * `decisions.plan_track` already self-corrects this way; this is the same idea
 * for the task list.
 *
 * It never *creates* a checklist, only replaces a mismatched one. A matter with
 * no tasks has none for a reason — it predates the SLA engine, or its checklist
 * was deliberately cleared — and generating 40-odd tasks under someone who only
 * opened the drafting workspace would be a surprise, most of them already
 * overdue against a Day 0 in the past.
 *
 * Replacing is refused the moment any of the work is real; see
 * `templateSwapVerdict`.
 */
export async function resyncMatterSlaTemplate(
  admin: SupabaseClient,
  matterId: string,
  practiceArea: unknown,
): Promise<SlaTemplateResync> {
  try {
    // Existing Probate matters are not silently converted. The dedicated
    // track is opt-in for newly opened matters; an attorney may migrate an old
    // checklist deliberately after reviewing work already performed.
    if (normalizePracticeArea(practiceArea) === 'Probate') return 'skipped'
    const templateName = slaTemplateForPracticeArea(practiceArea)
    if (!templateName) return 'skipped'

    const { data: taskRows, error: tasksError } = await admin
      .from('tasks')
      .select('plan_template_id, status, notes, completed_at, skipped_at, paused_at')
      .eq('matter_id', matterId)
      .eq('source', 'sla')
    if (tasksError) throw new Error(tasksError.message)

    const tasks = (taskRows ?? []) as unknown as Parameters<typeof templateSwapVerdict>[0]
    if (tasks.length === 0) return 'no_checklist'

    const { data: templateRow, error: templateError } = await admin
      .from('sla_task_templates')
      .select('id')
      .eq('template_name', templateName)
      .maybeSingle<{ id: string }>()
    if (templateError) throw new Error(templateError.message)
    // No such template yet — its migration has not been applied to this
    // database. Leaving the checklist alone beats deleting it for nothing.
    if (!templateRow) return 'skipped'

    const verdict = templateSwapVerdict(tasks, templateRow.id)
    if (verdict === 'same_template') return 'unchanged'
    if (verdict === 'work_started') {
      console.warn(
        '[sla-tasks] matter',
        matterId,
        `belongs on "${templateName}" but its checklist has been worked; leaving it alone`,
      )
      return 'work_started'
    }

    const result = await generateMatterTasks(admin, {
      matterId,
      templateName,
      startDate: firmTodayKey(),
      replace: true,
    })
    if (!result.ok) {
      console.warn('[sla-tasks] resync failed for matter', matterId, result.error)
      return 'failed'
    }
    console.info('[sla-tasks] matter', matterId, `moved onto "${templateName}"`)
    return 'swapped'
  } catch (e) {
    // Never take down the caller: this runs on a page load.
    console.warn('[sla-tasks] resync failed for matter', matterId, e)
    return 'failed'
  }
}

export interface ApplyAnchorResult {
  ok: boolean
  updated: number
  error?: string
}

/**
 * Date the tasks waiting on `anchor` now that it has happened — the client books
 * the PMPS, or signs and starts the firm clock.
 *
 * Recomputed from each task's stored offsets rather than shifted, so re-running
 * after the date moves again is idempotent rather than cumulative.
 */
export async function applySlaAnchor(
  admin: SupabaseClient,
  matterId: string,
  anchor: SlaClockAnchor,
  anchorDate: string,
): Promise<ApplyAnchorResult> {
  if (!isDateKey(anchorDate)) {
    return { ok: false, updated: 0, error: 'anchor date must be a calendar date (YYYY-MM-DD)' }
  }

  let plan: PlanTask[]
  try {
    plan = await fetchPlanTasks(admin, matterId)
  } catch (e) {
    return { ok: false, updated: 0, error: e instanceof Error ? e.message : 'Task lookup failed' }
  }

  const adopted = new Map(plan.map(task => [task.id, task.stage_entered_at !== null]))
  const updates = rescheduleForAnchor(plan, anchor, anchorDate)
  for (const update of updates) {
    const { error: updateError } = await admin
      .from('tasks')
      .update(planDateColumns(update, { adopted: adopted.get(update.id) === true }))
      .eq('id', update.id)
    if (updateError) return { ok: false, updated: 0, error: updateError.message }
  }
  return { ok: true, updated: updates.length }
}
