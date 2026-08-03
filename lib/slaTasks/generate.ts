import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmTodayKey } from '@/lib/firmDate'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { buildMatterTaskInserts, isDateKey, parseTemplateTasks } from './schedule'
import { MATTER_TASK_COLUMNS, type MatterTaskRow, type SlaTemplateRow } from './types'

export const ESTATE_PLANNING_SLA = 'estate_planning_sla'

export type GenerateResult =
  | { ok: true; created: true; tasks: MatterTaskRow[]; templateId: string }
  | { ok: true; created: false; reason: 'already_generated'; tasks: MatterTaskRow[] }
  | { ok: false; error: string; status: number }

interface GenerateOptions {
  matterId: string
  templateName?: string
  startDate?: string
  /** Discard any tasks already generated for this matter and start over. */
  replace?: boolean
}

/** Load a template and coerce its JSONB task array into typed definitions. */
export async function loadSlaTemplate(
  admin: SupabaseClient,
  templateName: string,
): Promise<SlaTemplateRow | null> {
  const { data, error } = await admin
    .from('sla_task_templates')
    .select('id, template_name, description, target_days, tasks, created_at, updated_at')
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
  const templateName = options.templateName?.trim() || ESTATE_PLANNING_SLA
  const startDate = options.startDate?.trim() || firmTodayKey()

  if (!isDateKey(startDate)) {
    return { ok: false, error: 'start_date must be a calendar date (YYYY-MM-DD)', status: 400 }
  }

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id')
    .eq('id', matterId)
    .maybeSingle()
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
    if (!replace) {
      return { ok: true, created: false, reason: 'already_generated', tasks: existingTasks }
    }
    const { error: deleteError } = await admin.from('matter_tasks').delete().eq('matter_id', matterId)
    if (deleteError) return { ok: false, error: deleteError.message, status: 500 }
  }

  const rows = buildMatterTaskInserts(template.tasks, {
    matterId,
    templateId: template.id,
    startDate,
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
 * Kick off the estate planning SLA for a freshly created matter. Best-effort by
 * design: a matter must never fail to be created because its checklist could not
 * be written. Probate matters are skipped until a probate template exists.
 */
export async function ensureEstatePlanningSlaTasks(
  matterId: string,
  options: { practiceArea?: unknown; startDate?: string } = {},
): Promise<void> {
  try {
    if (normalizePracticeArea(options.practiceArea) === 'Probate') return
    const result = await generateMatterTasks(getAdminClient(), {
      matterId,
      templateName: ESTATE_PLANNING_SLA,
      startDate: options.startDate ?? firmTodayKey(),
    })
    if (!result.ok) {
      console.warn('[sla-tasks] generation skipped for matter', matterId, result.error)
    }
  } catch (e) {
    console.warn('[sla-tasks] generation failed for matter', matterId, e)
  }
}
