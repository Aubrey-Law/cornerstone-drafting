import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { normalizePracticeArea } from '@/lib/practiceArea'
import {
  buildMatterTaskInserts,
  isDateKey,
  parseTemplateTasks,
  rescheduleForAnchor,
  templateSwapVerdict,
} from './schedule'
import {
  MATTER_TASK_COLUMNS,
  type MatterTaskRow,
  type SlaAnchorDates,
  type SlaClockAnchor,
  type SlaGate,
  type SlaTemplateRow,
  type SlaVariant,
} from './types'

export const ESTATE_PLANNING_SLA = 'estate_planning_sla'
export const ESTATE_PLANNING_SLA_V3 = 'estate_planning_sla_v3'
export const COLLEGE_PREP_SLA_V1 = 'college_prep_sla_v1'

/**
 * The checklist a practice area runs, or null when it has none.
 *
 * The College Preparation Plan gets its own rather than a trimmed estate one:
 * the estate checklist asks for a trust, deeds, funding, and a Certification of
 * Trust this plan never produces, and never asks the two questions that govern a
 * college plan — whether the student has turned 18, and when move-in is.
 *
 * Probate still has no template. It returns null and is skipped rather than
 * handed a checklist for work it does not do.
 */
export function slaTemplateForPracticeArea(practiceArea: unknown): string | null {
  const area = normalizePracticeArea(practiceArea)
  if (area === 'Probate') return null
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

export type GenerateResult =
  | { ok: true; created: true; tasks: MatterTaskRow[]; templateId: string }
  | {
      ok: true
      created: false
      reason: 'already_generated' | 'template_in_progress'
      tasks: MatterTaskRow[]
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
 * Instantiate an SLA template into `matter_tasks` for one matter.
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

  const { data: existing, error: existingError } = await admin
    .from('matter_tasks')
    .select(MATTER_TASK_COLUMNS)
    .eq('matter_id', matterId)
    .order('due_date', { ascending: true })
    .order('sort_order', { ascending: true })
  if (existingError) return { ok: false, error: existingError.message, status: 500 }

  const existingTasks = (existing ?? []) as unknown as MatterTaskRow[]
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
    const { error: deleteError } = await admin.from('matter_tasks').delete().eq('matter_id', matterId)
    if (deleteError) return { ok: false, error: deleteError.message, status: 500 }
  }

  const rows = buildMatterTaskInserts(template.tasks, {
    matterId,
    templateId: template.id,
    startDate,
    anchors: anchorsFromMatter(matter),
    gatesMet: gatesFromMatter(matter),
    variants: options.variants ?? [],
  })

  const { data: inserted, error: insertError } = await admin
    .from('matter_tasks')
    .insert(rows)
    .select(MATTER_TASK_COLUMNS)
  if (insertError) return { ok: false, error: insertError.message, status: 500 }

  const tasks = ((inserted ?? []) as unknown as MatterTaskRow[]).sort(
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
    // A probate lead keeps the estate checklist it has always been given: there
    // is still no probate template, and an unqualified lead with no next action
    // on it is worse than one carrying a checklist of roughly the right shape.
    // A probate *matter* is still skipped, exactly as before.
    const templateName = slaTemplateForPracticeArea(options.practiceArea) ?? ESTATE_PLANNING_SLA_V3
    const result = await generateMatterTasks(getAdminClient(), {
      matterId,
      templateName,
      startDate: firmTodayKey(),
    })
    if (!result.ok) {
      console.warn('[sla-tasks] lead generation skipped for matter', matterId, result.error)
    }
  } catch (e) {
    console.warn('[sla-tasks] lead generation failed for matter', matterId, e)
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

  const { data, error } = await admin
    .from('matter_tasks')
    .select(MATTER_TASK_COLUMNS)
    .eq('matter_id', matterId)
  if (error) return { ok: false, updated: 0, error: error.message }

  const updates = rescheduleForAnchor((data ?? []) as unknown as MatterTaskRow[], anchor, anchorDate)
  for (const update of updates) {
    const { error: updateError } = await admin
      .from('matter_tasks')
      .update({
        due_date: update.due_date,
        nudge_date: update.nudge_date,
        escalation_date: update.escalation_date,
      })
      .eq('id', update.id)
    if (updateError) return { ok: false, updated: 0, error: updateError.message }
  }
  return { ok: true, updated: updates.length }
}
